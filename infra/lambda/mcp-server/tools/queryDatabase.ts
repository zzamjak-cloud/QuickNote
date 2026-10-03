// query_database — 클라 DB 뷰와 같은 검색·필터·정렬(src/lib/databaseQuery.ts applyFilterSortSearch 를 그대로 공유).
// 입력은 사람이 쓰는 형태(컬럼 이름·옵션 라벨·이메일·ISO 날짜)를 받아 클라 FilterRule/SortRule 로 변환한다.
import { z } from "zod";
import { applyFilterSortSearch, FILTER_OPERATORS } from "../../../../src/lib/databaseQuery";
import type { ColumnDef, FilterRule, SortRule } from "../../../../src/types/database";
import { optionId, resolveColumn, resolveWorkspaceMember } from "../cellInput";
import { NOT_ACCESSIBLE, requireWorkspace } from "../access";
import { ToolError, type McpContext } from "../context";
import { getItem } from "../ddb";
import { loadDatabaseRows, parseColumnDefs, toRowView } from "../dbRows";
import { collectPersonIds, loadMemberNames, parseColumns, renderCellValue, type ColumnLite } from "../properties";

const OPERATORS = FILTER_OPERATORS.map((o) => o.id) as [FilterRule["operator"], ...FilterRule["operator"][]];
const NO_VALUE_OPERATORS = new Set(["isEmpty", "isNotEmpty"]);
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const TABLE_COLUMNS = 8;

const filterInput = z
  .object({
    column: z.string().trim().min(1).max(200).describe("Column name or id"),
    operator: z.enum(OPERATORS),
    value: z.union([z.string().max(500), z.number(), z.boolean(), z.array(z.string().max(500)).min(1).max(50)]).optional()
      .describe("select/status/multiSelect: option label(s); person: member id/email; date: YYYY-MM-DD; checkbox: true/false. Several values = match any"),
  })
  .strict();

export const queryDatabaseInputShape = {
  databaseId: z.string().trim().min(1).max(256).describe("Database id"),
  filter: z.array(filterInput).max(20).optional().describe("All rules must match (AND)"),
  sorts: z.array(z.object({ column: z.string().trim().min(1).max(200), direction: z.enum(["asc", "desc"]).default("asc") }).strict())
    .max(5).optional().describe("Sort keys in priority order; empty values always sort last"),
  search: z.string().max(200).optional().describe("Whitespace-separated tokens; every token must appear in the title or a cell"),
  scope: z.object({
    organizationId: z.string().min(1).max(256).optional(),
    teamId: z.string().min(1).max(256).optional(),
    projectId: z.string().min(1).max(256).optional(),
    assigneeId: z.string().min(1).max(256).optional(),
  }).strict().optional().describe("Protected databases: narrow rows by org/team/project/assignee like the app (one applies: assignee > project > team > org)"),
  limit: z.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional().describe("nextCursor from a previous call"),
};
const queryDatabaseInput = z.object(queryDatabaseInputShape);
export type QueryDatabaseInput = z.input<typeof queryDatabaseInput>;

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const o = (JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { o?: unknown }).o;
    if (Number.isInteger(o) && (o as number) >= 0) return o as number;
  } catch {
    // 아래에서 공통 오류
  }
  throw new ToolError("Invalid cursor");
}

async function filterValues(ctx: McpContext, col: ColumnLite, raw: unknown, workspaceId: string): Promise<string[]> {
  const list = (Array.isArray(raw) ? raw : [raw]).map((v) => (typeof v === "string" ? v.trim() : v));
  const label = `Filter on "${col.name || col.id}" (${col.type})`;
  switch (col.type) {
    case "select":
    case "status":
    case "multiSelect":
      return list.map((v) => optionId(col, String(v)));
    case "person":
      return Promise.all(list.map(async (v) => {
        const id = await resolveWorkspaceMember(ctx, String(v), workspaceId);
        if (!id) throw new ToolError(`${label}: unknown member "${String(v)}" in this workspace`);
        return id;
      }));
    case "checkbox":
      return list.map((v) => {
        if (v === true || v === "true") return "예";
        if (v === false || v === "false") return "아니오";
        throw new ToolError(`${label}: expected true or false`);
      });
    case "date":
      return list.map((v) => {
        if (typeof v !== "string" || !YMD.test(v)) throw new ToolError(`${label}: expected YYYY-MM-DD`);
        return v;
      });
    case "number":
      return list.map((v) => {
        if (!Number.isFinite(Number(v)) || v === "") throw new ToolError(`${label}: expected a number`);
        return String(Number(v));
      });
    default:
      return list.map(String);
  }
}

async function toFilterRules(ctx: McpContext, columns: ColumnLite[], input: z.infer<typeof queryDatabaseInput>, workspaceId: string) {
  const rules: FilterRule[] = [];
  for (const [i, f] of (input.filter ?? []).entries()) {
    const col = resolveColumn(columns, f.column);
    if (NO_VALUE_OPERATORS.has(f.operator)) {
      rules.push({ id: `f${i}`, columnId: col.id, operator: f.operator });
      continue;
    }
    if (f.value === undefined) throw new ToolError(`Filter on "${col.name}" with ${f.operator} needs a value`);
    const values = await filterValues(ctx, col, f.value, workspaceId);
    rules.push({ id: `f${i}`, columnId: col.id, operator: f.operator, value: values.length === 1 ? values[0] : values });
  }
  return rules;
}

function cellForTable(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").slice(0, 200);
}

async function renderTable(ctx: McpContext, columns: ColumnLite[], rows: ReturnType<typeof toRowView>[]): Promise<string[]> {
  const shown = columns.filter((c) => c.type !== "title").slice(0, TABLE_COLUMNS);
  const names = await loadMemberNames(ctx.doc, ctx.tables.Members, collectPersonIds(shown, rows.map((r) => r.cells)));
  const header = ["id", "title", ...shown.map((c) => c.name || c.id)];
  return [
    `| ${header.map(cellForTable).join(" | ")} |`,
    `|${header.map(() => " --- ").join("|")}|`,
    ...rows.map((r) => {
      const cells = [r.pageId, r.title || "Untitled", ...shown.map((c) => renderCellValue(c, r.cells[c.id], names))];
      return `| ${cells.map(cellForTable).join(" | ")} |`;
    }),
  ];
}

export async function queryDatabaseTool(ctx: McpContext, raw: QueryDatabaseInput): Promise<string> {
  const input = queryDatabaseInput.parse(raw);
  const db = await getItem(ctx.doc, ctx.tables.Databases, { id: input.databaseId });
  if (!db) throw new ToolError(NOT_ACCESSIBLE);
  const workspaceId = String(db.workspaceId ?? "");
  await requireWorkspace(ctx, workspaceId);
  if (db.deletedAt) throw new ToolError("This database is in the trash.");

  const columns = parseColumns(db.columns);
  const defs: ColumnDef[] = parseColumnDefs(db.columns);
  const filterRules = await toFilterRules(ctx, columns, input, workspaceId);
  const sortRules: SortRule[] = (input.sorts ?? []).map((s) => ({ columnId: resolveColumn(columns, s.column).id, dir: s.direction }));
  const offset = decodeCursor(input.cursor);

  const loaded = await loadDatabaseRows(ctx, db, input.scope ?? {});
  const views = loaded.rows.map((r) => toRowView(r, String(db.id), defs));
  const matched = applyFilterSortSearch(views, defs, input.search ?? "", filterRules, sortRules);
  const page = matched.slice(offset, offset + input.limit);
  const next = offset + page.length < matched.length ? encodeCursor(offset + page.length) : null;

  return [
    "---",
    `databaseId: ${String(db.id)}`,
    `title: ${String(db.title ?? "") || "Untitled database"}`,
    `matched: ${matched.length}`,
    `returned: ${page.length}`,
    `scannedRows: ${loaded.rows.length}`,
    `truncated: ${loaded.truncated}`,
    ...(next ? [`nextCursor: ${next}`] : []),
    "---",
    ...(page.length > 0 ? await renderTable(ctx, columns, page) : ["(no matching rows)"]),
    "",
    `rowIds: ${JSON.stringify(page.map((r) => r.pageId))}`,
    ...(loaded.truncated ? ["", "Note: only the first 5000 rows were scanned; narrow with scope or filters."] : []),
  ].join("\n");
}
