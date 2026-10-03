// fetch — 페이지(헤더·속성·하위 페이지·본문 QFM) 또는 DB(스키마·행)를 Markdown 으로.
import { z } from "zod";
import { docToQfm } from "../../../../src/lib/docModel/markdown";
import { NOT_ACCESSIBLE, requireWorkspace } from "../access";
import { ToolError, type McpContext } from "../context";
import { getItem } from "../ddb";
import { loadPageBody } from "../pageBody";
import { ancestorTitles, scanWorkspaceMetas, MAX_SCANNED_METAS, type PageMeta } from "../pageScan";
import { collectPersonIds, loadMemberNames, parseCells, parseColumns, renderProperties } from "../properties";
import { renderDatabase, renderDatabaseSection } from "./fetchDatabase";

/** fetch 출력 상한(UTF-8 바이트). 초과분은 잘라내고 안내 문구를 붙인다. */
export const MAX_FETCH_OUTPUT_BYTES = 200 * 1024;
const MAX_CHILD_PAGES = 100;

export const fetchInputShape = {
  id: z.string().trim().min(1).max(256).describe("Page or database id (from search results or <mention-page id>)"),
  includeTrashed: z.boolean().default(false).describe("Return the item even if it is in the trash"),
  cursor: z.string().max(4096).optional().describe("Database row pagination cursor (nextCursor from a previous fetch)"),
};
const fetchInput = z.object(fetchInputShape);
export type FetchInput = z.input<typeof fetchInput>;

export function capOutput(text: string, maxBytes = MAX_FETCH_OUTPUT_BYTES): string {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= maxBytes) return text;
  // 바이트 단위로 자른 뒤 깨진 마지막 문자(U+FFFD)를 제거한다.
  const cut = Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8").replace(/�+$/, "");
  return `${cut}\n\n[truncated: output exceeded ${Math.round(maxBytes / 1024)}KB (${bytes} bytes total)]`;
}

function assertNotTrashed(item: Record<string, unknown>, includeTrashed: boolean): void {
  if (item.deletedAt && !includeTrashed) {
    throw new ToolError("This item is in the trash. Pass includeTrashed: true to read it anyway.");
  }
}

async function propertyLines(ctx: McpContext, db: Record<string, unknown> | null, page: Record<string, unknown>) {
  if (!db) return [];
  const columns = parseColumns(db.columns);
  const cells = parseCells(page.dbCells);
  const names = await loadMemberNames(ctx.doc, ctx.tables.Members, collectPersonIds(columns, [cells]));
  const props = renderProperties(columns, cells, names);
  return ["## Properties", ...props.map((p) => `- ${p.name}: ${p.value}`), ""];
}

function childLines(pageId: string, metas: PageMeta[], truncated: boolean): string[] {
  const children = metas.filter((m) => m.parentId === pageId && !m.deleted);
  if (children.length === 0 && !truncated) return [];
  const shown = children.slice(0, MAX_CHILD_PAGES);
  return [
    "## Child pages",
    ...shown.map((c) => `- <mention-page id="${c.id}"/> ${c.title || "Untitled"}`),
    ...(children.length > shown.length ? [`- … ${children.length - shown.length} more`] : []),
    ...(truncated ? ["- (child list may be incomplete: workspace scan limit reached)"] : []),
    "",
  ];
}

async function loadSameWorkspaceDb(ctx: McpContext, id: unknown, workspaceId: string) {
  if (typeof id !== "string" || !id) return null;
  const db = await getItem(ctx.doc, ctx.tables.Databases, { id });
  return db && String(db.workspaceId) === workspaceId ? db : null;
}

async function renderPage(ctx: McpContext, page: Record<string, unknown>, cursor?: string): Promise<string> {
  const pageId = String(page.id);
  const workspaceId = String(page.workspaceId);
  const [body, scan, rowDb, homeDb] = await Promise.all([
    loadPageBody(ctx.collabRoomEpoch, page),
    scanWorkspaceMetas({ doc: ctx.doc, pagesTable: ctx.tables.Pages, workspaceId, budget: MAX_SCANNED_METAS }),
    loadSameWorkspaceDb(ctx, page.databaseId, workspaceId),
    loadSameWorkspaceDb(ctx, page.fullPageDatabaseId, workspaceId),
  ]);
  const byId = new Map(scan.metas.map((m) => [m.id, m]));
  const self = byId.get(pageId);
  const path = self ? ancestorTitles(self, byId) : [];
  const type = page.databaseId ? "database-row" : homeDb ? "full-page-database" : "page";
  const header = [
    "---",
    `id: ${pageId}`,
    `type: ${type}`,
    `workspaceId: ${workspaceId}`,
    ...(page.parentId ? [`parentId: ${String(page.parentId)}`] : []),
    ...(path.length > 0 ? [`path: ${path.join(" / ")}`] : []),
    ...(rowDb ? [`database: ${String(rowDb.title ?? "") || "Untitled"} (id: ${String(rowDb.id)})`] : []),
    ...(page.icon ? [`icon: ${String(page.icon)}`] : []),
    `updatedAt: ${String(page.updatedAt ?? "")}`,
    ...(page.lastEditedByName ? [`lastEditedBy: ${String(page.lastEditedByName)}`] : []),
    `bodySource: ${body.source}`,
    ...(page.deletedAt ? ["trashed: true"] : []),
    "---",
    `# ${String(page.title ?? "") || "Untitled"}`,
    "",
  ];
  return [
    ...header,
    ...(await propertyLines(ctx, rowDb, page)),
    ...childLines(pageId, scan.metas, scan.truncated),
    ...(homeDb ? [await renderDatabaseSection(ctx, homeDb, cursor), ""] : []),
    "## Content",
    docToQfm(body.doc) || "(empty)",
  ].join("\n");
}

export async function fetchTool(ctx: McpContext, raw: FetchInput): Promise<string> {
  const input = fetchInput.parse(raw);
  const page = await getItem(ctx.doc, ctx.tables.Pages, { id: input.id });
  if (page) {
    await requireWorkspace(ctx, String(page.workspaceId ?? ""));
    assertNotTrashed(page, input.includeTrashed);
    return capOutput(await renderPage(ctx, page, input.cursor));
  }
  const db = await getItem(ctx.doc, ctx.tables.Databases, { id: input.id });
  if (db) {
    await requireWorkspace(ctx, String(db.workspaceId ?? ""));
    assertNotTrashed(db, input.includeTrashed);
    return capOutput(await renderDatabase(ctx, db, input.cursor));
  }
  throw new ToolError(NOT_ACCESSIBLE);
}
