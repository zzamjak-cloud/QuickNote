// fetch(database) — 스키마(컬럼·옵션)·뷰 요약·첫 50행을 Markdown 으로.
import { listDatabaseRows } from "../../v5-resolvers/handlers/pageDatabase";
import { ToolError, type McpContext } from "../context";
import {
  collectPersonIds,
  loadMemberNames,
  parseCells,
  parseColumns,
  renderCellValue,
  type ColumnLite,
} from "../properties";

export const DATABASE_ROW_PAGE_SIZE = 50;
/** 행 표에 싣는 title 외 속성 수. */
const KEY_PROPERTY_COUNT = 5;
const VIEW_KINDS = ["table", "kanban", "timeline", "gallery", "list"] as const;

function encodeCursor(nextToken: string | null | undefined): string | null {
  return nextToken ? Buffer.from(nextToken, "utf8").toString("base64url") : null;
}

function decodeCursor(cursor: string | undefined): string | undefined {
  if (!cursor) return undefined;
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  try {
    JSON.parse(decoded);
  } catch {
    throw new ToolError("Invalid cursor");
  }
  return decoded;
}

function cellForTable(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").slice(0, 200);
}

function viewSummary(panelStateRaw: unknown): string[] {
  let panel: Record<string, unknown> = {};
  if (typeof panelStateRaw === "string") {
    try {
      panel = JSON.parse(panelStateRaw) as Record<string, unknown>;
    } catch {
      panel = {};
    }
  } else if (panelStateRaw && typeof panelStateRaw === "object") {
    panel = panelStateRaw as Record<string, unknown>;
  }
  const hidden = Array.isArray(panel.hiddenViewKinds) ? (panel.hiddenViewKinds as string[]) : [];
  const views = VIEW_KINDS.filter((k) => k === "table" || !hidden.includes(k));
  const sorts = Array.isArray(panel.sortRules) ? panel.sortRules.length : 0;
  const filters = Array.isArray(panel.filterRules) ? panel.filterRules.length : 0;
  return [
    `- Views: ${views.join(", ")}`,
    `- Group by column: ${typeof panel.groupByColumnId === "string" ? panel.groupByColumnId : "none"}`,
    `- Sort rules: ${sorts}, filter rules: ${filters}`,
  ];
}

function columnLines(columns: ColumnLite[]): string[] {
  return columns.map((c) => {
    const opts = c.options.length > 0 ? ` — options: ${c.options.map((o) => o.label).join(", ")}` : "";
    return `- ${c.name || c.id} (${c.type}, id: ${c.id})${opts}`;
  });
}

async function rowTable(ctx: McpContext, db: Record<string, unknown>, columns: ColumnLite[], cursor?: string) {
  const res = await listDatabaseRows({
    doc: ctx.doc,
    tables: ctx.tables,
    caller: ctx.caller,
    databaseId: String(db.id),
    workspaceId: String(db.workspaceId),
    limit: DATABASE_ROW_PAGE_SIZE,
    nextToken: decodeCursor(cursor),
  });
  const keyCols = columns.filter((c) => c.type !== "title").slice(0, KEY_PROPERTY_COUNT);
  const cellsList = res.items.map((row) => parseCells(row.dbCells));
  const names = await loadMemberNames(ctx.doc, ctx.tables.Members, collectPersonIds(keyCols, cellsList));
  const header = ["id", "title", ...keyCols.map((c) => c.name || c.id)];
  const lines = [`| ${header.map(cellForTable).join(" | ")} |`, `|${header.map(() => " --- ").join("|")}|`];
  res.items.forEach((row, i) => {
    const values = keyCols.map((c) => renderCellValue(c, cellsList[i][c.id], names));
    const cells = [String(row.id), String(row.title ?? "") || "Untitled", ...values];
    lines.push(`| ${cells.map(cellForTable).join(" | ")} |`);
  });
  return { lines, count: res.items.length, nextCursor: encodeCursor(res.nextToken) };
}

/** DB 섹션 Markdown. 풀페이지 DB 홈 페이지에서도 본문 뒤에 재사용한다. */
export async function renderDatabaseSection(
  ctx: McpContext,
  db: Record<string, unknown>,
  cursor?: string,
): Promise<string> {
  const columns = parseColumns(db.columns);
  const rows = await rowTable(ctx, db, columns, cursor);
  return [
    "## Columns",
    ...columnLines(columns),
    "",
    "## Views",
    ...viewSummary(db.panelState),
    "",
    `## Rows (${rows.count}${rows.nextCursor ? ", more available" : ""})`,
    ...(rows.count > 0 ? rows.lines : ["(no rows)"]),
    ...(rows.nextCursor ? ["", `nextCursor: ${rows.nextCursor}`] : []),
  ].join("\n");
}

export async function renderDatabase(
  ctx: McpContext,
  db: Record<string, unknown>,
  cursor?: string,
): Promise<string> {
  const header = [
    "---",
    `id: ${String(db.id)}`,
    "type: database",
    `workspaceId: ${String(db.workspaceId)}`,
    `updatedAt: ${String(db.updatedAt ?? "")}`,
    ...(db.deletedAt ? ["trashed: true"] : []),
    "---",
    `# ${String(db.title ?? "") || "Untitled database"}`,
    "",
  ];
  return [...header, await renderDatabaseSection(ctx, db, cursor)].join("\n");
}
