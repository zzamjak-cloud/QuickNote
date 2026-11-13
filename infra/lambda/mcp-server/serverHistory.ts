// 히스토리·휴지통 툴 등록 — 버전 목록·저장·복원, 휴지통 목록·복원, DB 휴지통 이동, 영구 삭제(confirm 필수).
// 쓰기 툴은 beginWrite(write scope·일일 상한) 후 각 툴이 워크스페이스 edit·MCP 정책을 검사한다. 감사 로그는 runTool.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpContext } from "./context";
import { runTool } from "./toolRunner";
import { beginWrite } from "./writeAccess";
import {
  listDatabaseHistoryInputShape, listDatabaseHistoryTool,
  listDatabaseRowHistoryInputShape, listDatabaseRowHistoryTool,
  restoreDatabaseVersionInputShape, restoreDatabaseVersionTool,
} from "./tools/history/databaseHistory";
import {
  listPageHistoryInputShape, listPageHistoryTool,
  restorePageVersionInputShape, restorePageVersionTool,
  savePageVersionInputShape, savePageVersionTool,
} from "./tools/history/pageHistory";
import {
  emptyTrashInputShape, emptyTrashTool,
  permanentlyDeleteDatabaseInputShape, permanentlyDeleteDatabaseTool,
  permanentlyDeletePageInputShape, permanentlyDeletePageTool,
} from "./tools/history/permanentDelete";
import {
  listTrashInputShape, listTrashTool,
  restoreDatabaseInputShape, restoreDatabaseTool,
  restorePageInputShape, restorePageTool,
  trashDatabaseInputShape, trashDatabaseTool,
} from "./tools/history/trash";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const DESTRUCTIVE = { ...WRITE, destructiveHint: true } as const;

const WRITE_NOTE = "Requires a token with write scope and edit access to the workspace.";
const CONFIRM_NOTE =
  "IRREVERSIBLE: requires confirm: true — ask the user for explicit approval first. Only items already in the trash.";

/** 단건 쓰기 툴: 1 unit 을 먼저 소비. 일괄 툴(복원·휴지통 이동·영구 삭제)은 인가·confirm 확인 후 영향 페이지 수만큼 툴 안에서 소비한다. */
function gated<T>(ctx: McpContext, fn: () => Promise<T>): () => Promise<T> {
  return async () => {
    await beginWrite(ctx, 1);
    return fn();
  };
}

export function registerHistoryTools(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    "list_page_history",
    {
      description: "List saved versions of a page or database row (newest first, 180-day retention): historyId, kind, time, editors, title. Works for trashed pages.",
      inputSchema: listPageHistoryInputShape,
      annotations: READ_ONLY,
    },
    async (args) => runTool(ctx, "list_page_history", { pageIds: [args.pageId] }, () => listPageHistoryTool(ctx, args)),
  );

  server.registerTool(
    "save_page_version",
    {
      description: `Save the current page state (live collaborative body) as a version checkpoint. ${WRITE_NOTE}`,
      inputSchema: savePageVersionInputShape,
      annotations: WRITE,
    },
    async (args) =>
      runTool(ctx, "save_page_version", { pageIds: [args.pageId] }, gated(ctx, () => savePageVersionTool(ctx, args)), (r) => ({ historyId: r.historyId })),
  );

  server.registerTool(
    "restore_page_version",
    {
      description:
        "Restore a page or database row to a version from list_page_history / list_database_row_history. The current body is " +
        "checkpointed first; the restored body and row cells are applied live to open editors. Also brings back trashed or " +
        `expired deleted rows. ${WRITE_NOTE}`,
      inputSchema: restorePageVersionInputShape,
      annotations: DESTRUCTIVE,
    },
    async (args) =>
      runTool(ctx, "restore_page_version", { pageIds: [args.pageId], historyId: args.historyId }, gated(ctx, () => restorePageVersionTool(ctx, args))),
  );

  server.registerTool(
    "list_database_history",
    {
      description: "List structure versions of a database (title, columns, views; newest first) with column/row counts. Works for trashed databases.",
      inputSchema: listDatabaseHistoryInputShape,
      annotations: READ_ONLY,
    },
    async (args) => runTool(ctx, "list_database_history", { databaseId: args.databaseId }, () => listDatabaseHistoryTool(ctx, args)),
  );

  server.registerTool(
    "restore_database_version",
    {
      description:
        "Restore a database's structure (title, columns, views) to a version from list_database_history. Current structure is " +
        `checkpointed first; live views update immediately. Deleted rows are not restored. ${WRITE_NOTE}`,
      inputSchema: restoreDatabaseVersionInputShape,
      annotations: DESTRUCTIVE,
    },
    async (args) =>
      runTool(ctx, "restore_database_version", { databaseId: args.databaseId, historyId: args.historyId }, gated(ctx, () => restoreDatabaseVersionTool(ctx, args))),
  );

  server.registerTool(
    "list_database_row_history",
    {
      description: "List version entries of all rows of a database, including deleted rows (rowDeleted). Paginate with cursor. Restore a row with restore_page_version.",
      inputSchema: listDatabaseRowHistoryInputShape,
      annotations: READ_ONLY,
    },
    async (args) => runTool(ctx, "list_database_row_history", { databaseId: args.databaseId }, () => listDatabaseRowHistoryTool(ctx, args)),
  );

  server.registerTool(
    "list_trash",
    {
      description: "List trashed pages and databases of a workspace (newest first, kept 30 days) with days until automatic purge.",
      inputSchema: listTrashInputShape,
      annotations: READ_ONLY,
    },
    async (args) => runTool(ctx, "list_trash", { workspaceId: args.workspaceId }, () => listTrashTool(ctx, args)),
  );

  server.registerTool(
    "restore_page",
    {
      description: `Restore a page from the trash (by default with child pages trashed together). Database rows reappear in live views. ${WRITE_NOTE}`,
      inputSchema: restorePageInputShape,
      annotations: WRITE,
    },
    async (args) =>
      runTool(ctx, "restore_page", { pageIds: [args.pageId] }, () => restorePageTool(ctx, args), (r) => ({ restoredIds: r.restored })),
  );

  server.registerTool(
    "restore_database",
    {
      description: `Restore a database from the trash (by default with its rows and full-page home trashed together). ${WRITE_NOTE}`,
      inputSchema: restoreDatabaseInputShape,
      annotations: WRITE,
    },
    async (args) =>
      runTool(ctx, "restore_database", { databaseId: args.databaseId }, () => restoreDatabaseTool(ctx, args), (r) => ({ restoredIds: r.restoredPages })),
  );

  server.registerTool(
    "trash_database",
    {
      description: `Move a database with its rows and full-page home to the trash (restorable with restore_database for 30 days). Scheduler databases are refused. ${WRITE_NOTE}`,
      inputSchema: trashDatabaseInputShape,
      annotations: DESTRUCTIVE,
    },
    async (args) => runTool(ctx, "trash_database", { databaseId: args.databaseId }, () => trashDatabaseTool(ctx, args)),
  );

  server.registerTool(
    "permanently_delete_page",
    {
      description: `Permanently delete one trashed page with its comments. ${CONFIRM_NOTE} ${WRITE_NOTE}`,
      inputSchema: permanentlyDeletePageInputShape,
      annotations: DESTRUCTIVE,
    },
    async (args) =>
      runTool(ctx, "permanently_delete_page", { pageIds: [args.pageId], confirm: args.confirm === true }, () => permanentlyDeletePageTool(ctx, args)),
  );

  server.registerTool(
    "permanently_delete_database",
    {
      description: `Permanently delete a trashed database with all its row pages, row comments and structure history. Scheduler databases are refused. ${CONFIRM_NOTE} ${WRITE_NOTE}`,
      inputSchema: permanentlyDeleteDatabaseInputShape,
      annotations: DESTRUCTIVE,
    },
    async (args) =>
      runTool(ctx, "permanently_delete_database", { databaseId: args.databaseId, confirm: args.confirm === true }, () => permanentlyDeleteDatabaseTool(ctx, args)),
  );

  server.registerTool(
    "empty_trash",
    {
      description: `Permanently delete every trashed page of a workspace (trashed databases are kept). ${CONFIRM_NOTE} ${WRITE_NOTE}`,
      inputSchema: emptyTrashInputShape,
      annotations: DESTRUCTIVE,
    },
    async (args) =>
      runTool(ctx, "empty_trash", { workspaceId: args.workspaceId, confirm: args.confirm === true }, () => emptyTrashTool(ctx, args), (r) => ({ deletedPages: r.deletedPages })),
  );
}
