// DB 행 로드 — listDatabaseRows(권한·scope GSI·휴지통 제외) 를 페이지 단위로 돌며 상한까지 모은다.
// 행 판정·순서는 클라 collectRowPageIdsForDatabases(src/lib/sync/storeApply/rowOrder.ts)와 같다:
// 템플릿(_qn_isTemplate === "1" 또는 templates[].pageId)은 제외, order 숫자 오름차순 → id.
import type { ColumnDef, DatabaseRowView } from "../../../src/types/database";
import { listDatabaseRows } from "../v5-resolvers/handlers/pageDatabase";
import type { McpContext } from "./context";
import { parseCells } from "./properties";
import { checkTokenRateLimit } from "./rateLimit";

/** 한 번의 툴 호출에서 읽는 행 상한. */
export const MAX_SCANNED_ROWS = 5000;
/** 스캔 비용 — 이 행 수마다 분당 rate limit 1 unit 을 추가 차감한다. */
export const ROWS_PER_RATE_UNIT = 1000;
/**
 * 행 판정·표시·필터·scope 에 필요한 속성만 읽는다(본문 doc·blockComments 제외 — 행당 수백 KB 가능).
 * dbScope* 는 보호 DB scope GSI 키, lc-* scope 값은 dbCells 안에 있다.
 */
const ROW_PROJECTION = ["id", "title", "icon", "dbCells", "order", "workspaceId", "deletedAt", "databaseId", "dbScopeOrg", "dbScopeTeam", "dbScopeProject"];
const PAGE_SIZE = 200;
const TEMPLATE_MARKER = "_qn_isTemplate";

type Item = Record<string, unknown>;

/** listDatabaseRows 의 선택 scope(보호 DB 의 조직·팀·프로젝트·담당자 GSI). 앱과 같은 우선순위로 하나만 적용된다. */
export type RowScope = { organizationId?: string; teamId?: string; projectId?: string; assigneeId?: string };

export type LoadedRows = { rows: Item[]; truncated: boolean; scanned: number };

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parseColumnDefs(raw: unknown): ColumnDef[] {
  return parseJsonArray(raw).filter(
    (c): c is ColumnDef => Boolean(c) && typeof c === "object" && typeof (c as ColumnDef).id === "string",
  );
}

export function templatePageIds(db: Item): Set<string> {
  return new Set(
    parseJsonArray(db.templates)
      .map((t) => (t && typeof t === "object" ? (t as { pageId?: unknown }).pageId : null))
      .filter((id): id is string => typeof id === "string" && id !== ""),
  );
}

export function isTemplateRow(row: Item, templates: Set<string>): boolean {
  return parseCells(row.dbCells)[TEMPLATE_MARKER] === "1" || templates.has(String(row.id));
}

/** 클라와 같은 행 순서(order 숫자 오름차순, 동률은 id). GSI 정렬키(order)는 문자열이라 그대로 쓰면 "10" < "9" 가 된다. */
export function sortRowsByOrder(rows: Item[]): Item[] {
  const key = (r: Item) => (Number.isFinite(Number(r.order)) ? Number(r.order) : 0);
  return [...rows].sort((a, b) => key(a) - key(b) || String(a.id).localeCompare(String(b.id)));
}

export async function loadDatabaseRows(
  ctx: McpContext,
  db: Item,
  scope: RowScope = {},
  max: number = MAX_SCANNED_ROWS,
): Promise<LoadedRows> {
  const templates = templatePageIds(db);
  const rows: Item[] = [];
  let nextToken: string | undefined;
  let scanned = 0;
  do {
    const res = await listDatabaseRows({
      doc: ctx.doc,
      tables: ctx.tables,
      caller: ctx.caller,
      databaseId: String(db.id),
      workspaceId: String(db.workspaceId),
      ...scope,
      limit: Math.min(PAGE_SIZE, max - scanned),
      nextToken,
      projection: ROW_PROJECTION,
    });
    scanned += res.items.length;
    rows.push(...res.items.filter((r) => !isTemplateRow(r, templates)));
    nextToken = res.nextToken ?? undefined;
  } while (nextToken && scanned < max);
  await chargeScan(ctx, scanned);
  return { rows: sortRowsByOrder(rows), truncated: Boolean(nextToken), scanned };
}

/** 스캔한 행 수만큼 분당 카운터 추가 차감(1000행당 1). 한도 초과는 다음 요청부터 429 로 막힌다. */
async function chargeScan(ctx: McpContext, scanned: number): Promise<void> {
  const units = Math.floor(scanned / ROWS_PER_RATE_UNIT);
  if (units === 0) return;
  await checkTokenRateLimit({ doc: ctx.doc, tableName: ctx.tables.RateLimit, tokenId: ctx.token.tokenId, units });
}

/** 클라 DatabaseRowView 와 같은 모양 — title 컬럼 셀은 페이지 제목. */
export function toRowView(row: Item, databaseId: string, columns: ColumnDef[]): DatabaseRowView {
  const title = typeof row.title === "string" ? row.title : "";
  const cells = parseCells(row.dbCells) as DatabaseRowView["cells"];
  const titleCol = columns.find((c) => c.type === "title");
  return {
    pageId: String(row.id),
    databaseId,
    title,
    icon: typeof row.icon === "string" ? row.icon : null,
    cells: titleCol ? { ...cells, [titleCol.id]: title } : cells,
  };
}
