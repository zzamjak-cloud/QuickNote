// 쓰기 툴 등록(P2). 모든 쓰기는 토큰 write scope + 워크스페이스 edit 권한이 필요하다(writeAccess.ts).
// 감사 로그: tool·tokenId·memberId·pageIds·mode·bytes·ms(runTool).
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { QFM_SYNTAX_GUIDE } from "../../../src/lib/docModel/markdown";
import type { McpContext } from "./context";
import { runTool } from "./toolRunner";
import { beginWrite } from "./writeAccess";
import { createCommentInputShape, createCommentTool } from "./tools/createComment";
import { createDatabaseInputShape, createDatabaseTool } from "./tools/createDatabase";
import { databaseChangeUnits, updateDatabaseInputShape, updateDatabaseTool } from "./tools/updateDatabase";
import { createPagesInputShape, createPagesTool } from "./tools/createPages";
import { duplicatePageInputShape, duplicatePageTool } from "./tools/duplicatePage";
import { movePagesInputShape, movePagesTool } from "./tools/movePages";
import { trashPageInputShape, trashPageTool } from "./tools/trashPage";
import { updatePageInputShape, updatePageTool } from "./tools/updatePage";

const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const DESTRUCTIVE = { ...WRITE, destructiveHint: true } as const;

const WRITE_NOTE = "Requires a token with write scope and edit access to the workspace.";

/** write scope·일일 쓰기 상한(units = 쓰는 페이지 수)을 통과한 뒤에만 툴 본체를 실행한다. */
function gated<T>(ctx: McpContext, fn: () => Promise<T>, units = 1): () => Promise<T> {
  return async () => {
    await beginWrite(ctx, units);
    return fn();
  };
}

function bytes(text: string | undefined): number {
  return text ? Buffer.byteLength(text, "utf8") : 0;
}

export function registerWriteTools(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    "create_pages",
    {
      description:
        "Create 1-20 pages under a parent page, at a workspace top level, or as rows of a database (with properties). " +
        "Titles of regular pages get a (1), (2)… suffix if already used in the workspace. Returns the new page ids. " +
        `${WRITE_NOTE}\n\n${QFM_SYNTAX_GUIDE}`,
      inputSchema: createPagesInputShape,
      annotations: WRITE,
    },
    async (args) =>
      runTool(
        ctx,
        "create_pages",
        { parent: args.parent, count: args.pages.length, bytes: args.pages.reduce((n, p) => n + bytes(p.content), 0) },
        gated(ctx, () => createPagesTool(ctx, args), args.pages.length),
        (r) => ({ pageIds: r.pages.map((p) => p.id) }),
      ),
  );

  server.registerTool(
    "update_page",
    {
      description:
        "Update a page's title, icon, database-row properties and/or body. Body modes: replace (whole body; keep <qn-block> " +
        "lines from fetch to preserve opaque blocks), append, insert_after (anchor = exact text of a top-level block), " +
        "replace_range (rangeStart/rangeEnd = text prefixes of top-level blocks). Edits merge live into open editors. " +
        "replace/replace_range first save a version-history checkpoint so the user can restore. " +
        `${WRITE_NOTE}\n\n${QFM_SYNTAX_GUIDE}`,
      inputSchema: updatePageInputShape,
      annotations: DESTRUCTIVE,
    },
    async (args) =>
      runTool(
        ctx,
        "update_page",
        { pageIds: [args.pageId], mode: args.content?.mode ?? null, bytes: bytes(args.content?.markdown) },
        gated(ctx, () => updatePageTool(ctx, args)),
      ),
  );

  server.registerTool(
    "move_pages",
    {
      description: `Move 1-20 pages under another page or to the workspace top level (same workspace only; database rows cannot be moved). ${WRITE_NOTE}`,
      inputSchema: movePagesInputShape,
      annotations: WRITE,
    },
    async (args) =>
      runTool(ctx, "move_pages", { pageIds: args.pageIds, newParent: args.newParent }, gated(ctx, () => movePagesTool(ctx, args), new Set(args.pageIds).size)),
  );

  server.registerTool(
    "duplicate_page",
    {
      description: `Duplicate a page (without its child pages) right after the original, titled "<title> (Copy)". ${WRITE_NOTE}`,
      inputSchema: duplicatePageInputShape,
      annotations: WRITE,
    },
    async (args) =>
      runTool(ctx, "duplicate_page", { pageIds: [args.pageId] }, gated(ctx, () => duplicatePageTool(ctx, args)), (r) => ({ createdId: r.id })),
  );

  server.registerTool(
    "trash_page",
    {
      description:
        "Move a page and its child pages to the trash (restorable in QuickNote for 30 days). Permanent deletion is not available. " +
        WRITE_NOTE,
      inputSchema: trashPageInputShape,
      annotations: DESTRUCTIVE,
    },
    async (args) =>
      runTool(ctx, "trash_page", { pageIds: [args.pageId] }, gated(ctx, () => trashPageTool(ctx, args)), (r) => ({ trashedIds: r.trashed })),
  );

  server.registerTool(
    "create_comment",
    {
      description: `Add a comment to a page block (defaults to the first block). ${WRITE_NOTE}`,
      inputSchema: createCommentInputShape,
      annotations: WRITE,
    },
    async (args) =>
      runTool(ctx, "create_comment", { pageIds: [args.pageId], bytes: bytes(args.text) }, gated(ctx, () => createCommentTool(ctx, args))),
  );

  server.registerTool(
    "create_database",
    {
      description:
        "Create a database with a title column plus the given columns. layout inline: appended as a database block to parent.pageId. " +
        "layout fullPage: a full-page database (opened from the database list); with parent.pageId a button to it is appended there. " +
        `Column types: text, number, select, multiSelect, status, date, checkbox, url, email, phone, person, pageLink. Add rows with create_pages {parent:{databaseId}}. ${WRITE_NOTE}`,
      inputSchema: createDatabaseInputShape,
      annotations: WRITE,
    },
    async (args) =>
      runTool(
        ctx,
        "create_database",
        { parent: args.parent, layout: args.layout ?? "inline", columns: args.columns?.length ?? 0 },
        gated(ctx, () => createDatabaseTool(ctx, args), 1 + (args.columns?.length ?? 0)),
        (r) => ({ databaseId: r.databaseId }),
      ),
  );

  server.registerTool(
    "update_database",
    {
      description:
        "Rename a database and add, update (rename, change type without value conversion, add/rename select options) or remove columns. " +
        "Removing columns first saves a version-history checkpoint; the title column cannot be removed or retyped. Live views update immediately. " +
        WRITE_NOTE,
      inputSchema: updateDatabaseInputShape,
      annotations: DESTRUCTIVE,
    },
    async (args) =>
      runTool(
        ctx,
        "update_database",
        { databaseId: args.databaseId, add: args.addColumns?.length ?? 0, update: args.updateColumns?.length ?? 0, remove: args.removeColumns?.length ?? 0 },
        gated(ctx, () => updateDatabaseTool(ctx, args), databaseChangeUnits(args)),
      ),
  );
}
