// DB 행 속성 입력(사람이 읽는 값) → dbCells 저장 형식 변환. 저장 형식은 클라 CellValue 와 같다:
// select/status=옵션 id, multiSelect=옵션 id[], person=멤버 id[], pageLink=페이지 id[], date={start,end?}.
// title 컬럼은 dbCells 가 아니라 페이지 제목이다.
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { hasWorkspaceViewAccess, type Member } from "../v5-resolvers/handlers/_auth";
import { ToolError, type McpContext } from "./context";
import { batchGetByKey, getItem } from "./ddb";
import { parseColumns, type ColumnLite } from "./properties";

export type ConvertedProperties = { cells: Record<string, unknown>; title?: string };

const MAX_LIST_VALUES = 50;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SUPPORTED = ["title", "text", "number", "select", "multiSelect", "status", "date", "checkbox", "url", "email", "phone", "person", "pageLink"];

function fail(col: ColumnLite, message: string): never {
  throw new ToolError(`Property "${col.name || col.id}" (${col.type}): ${message}`);
}

export function resolveColumn(columns: ColumnLite[], key: string): ColumnLite {
  const byId = columns.find((c) => c.id === key);
  if (byId) return byId;
  const exact = columns.filter((c) => c.name === key);
  const matches = exact.length > 0 ? exact : columns.filter((c) => c.name.toLowerCase() === key.toLowerCase());
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new ToolError(`Property "${key}" is ambiguous; use the column id instead`);
  throw new ToolError(`Unknown property "${key}". Columns: ${columns.map((c) => `${c.name} (${c.type})`).join(", ")}`);
}

function asList(col: ColumnLite, value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  if (list.length > MAX_LIST_VALUES) fail(col, `at most ${MAX_LIST_VALUES} values`);
  return list.map((v) => {
    if (typeof v !== "string" || v.trim() === "") fail(col, "values must be non-empty strings");
    return v.trim();
  });
}

function asString(col: ColumnLite, value: unknown): string {
  if (typeof value !== "string") fail(col, "expected a string");
  if (value.length > 10_000) fail(col, "value is too long (max 10000 chars)");
  return value;
}

export function optionId(col: ColumnLite, value: string): string {
  const hit = col.options.find((o) => o.label === value || o.id === value)
    ?? col.options.find((o) => o.label.toLowerCase() === value.toLowerCase());
  if (hit) return hit.id;
  const valid = col.options.map((o) => o.label).join(", ") || "(no options)";
  return fail(col, `unknown option "${value}". Valid options: ${valid}`);
}

function toNumber(col: ColumnLite, value: unknown): number {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) fail(col, "expected a number");
  return n;
}

function toCheckbox(col: ColumnLite, value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "false") return value === "true";
  return fail(col, "expected true or false");
}

function toDate(col: ColumnLite, value: unknown): { start: string; end?: string } {
  const range = typeof value === "string" ? { start: value } : (value as { start?: unknown; end?: unknown } | null);
  const start = range?.start;
  const end = range?.end;
  if (typeof start !== "string" || !YMD.test(start)) fail(col, 'expected "YYYY-MM-DD" or {"start":"YYYY-MM-DD","end":"YYYY-MM-DD"}');
  if (end === undefined || end === null) return { start };
  if (typeof end !== "string" || !YMD.test(end) || end < start) fail(col, "end must be YYYY-MM-DD on or after start");
  return { start, end };
}

function toUrl(col: ColumnLite, value: unknown): string {
  const s = asString(col, value).trim();
  if (s !== "" && !/^https?:\/\//i.test(s)) fail(col, "URL must start with http:// or https://");
  return s;
}

function toEmail(col: ColumnLite, value: unknown): string {
  const s = asString(col, value).trim();
  if (s !== "" && !EMAIL.test(s)) fail(col, "invalid email address");
  return s;
}

async function findActiveMember(ctx: McpContext, ref: string): Promise<Member | null> {
  if (!ref.includes("@")) {
    const m = await getItem(ctx.doc, ctx.tables.Members, { memberId: ref });
    return m?.status === "active" ? (m as unknown as Member) : null;
  }
  const r = await ctx.doc.send(new QueryCommand({
    TableName: ctx.tables.Members,
    IndexName: "byEmail",
    KeyConditionExpression: "email = :e",
    ExpressionAttributeValues: { ":e": ref.toLowerCase() },
  }));
  const hit = (r.Items ?? []).find((m) => m.status === "active");
  return hit ? (hit as unknown as Member) : null;
}

/** 멤버 id/이메일 → 워크스페이스 접근 가능한 활성 멤버 id(아니면 null). */
export async function resolveWorkspaceMember(ctx: McpContext, ref: string, workspaceId: string): Promise<string | null> {
  const member = await findActiveMember(ctx, ref);
  // 개인 워크스페이스는 access 엔트리 없이 소유자만 쓴다(workspace.ts 와 같은 기준).
  const allowed = member !== null && (member.personalWorkspaceId === workspaceId || await hasWorkspaceViewAccess({
    doc: ctx.doc,
    memberTeamsTableName: ctx.tables.MemberTeams,
    workspaceAccessTableName: ctx.tables.WorkspaceAccess,
    caller: member,
    workspaceId,
  }));
  return member && allowed ? member.memberId : null;
}

/**
 * person 셀 값 — 대상 워크스페이스에 접근 가능한 활성 멤버만. 없음·권한 없음은 같은 문구로 돌려
 * 오류로 멤버 존재 여부를 알아낼 수 없게 한다.
 */
async function memberIdFor(ctx: McpContext, col: ColumnLite, ref: string, workspaceId: string): Promise<string> {
  const id = await resolveWorkspaceMember(ctx, ref, workspaceId);
  return id ?? fail(col, `unknown member "${ref}" in this workspace (use get_users for ids/emails)`);
}

async function pageLinkIds(ctx: McpContext, col: ColumnLite, ids: string[], workspaceId: string): Promise<string[]> {
  const found = await batchGetByKey({
    doc: ctx.doc, tableName: ctx.tables.Pages, keyName: "id", ids,
    projection: "id, workspaceId, deletedAt",
  });
  const ok = new Set(found.filter((p) => p.workspaceId === workspaceId && !p.deletedAt).map((p) => String(p.id)));
  const missing = ids.filter((id) => !ok.has(id));
  if (missing.length > 0) fail(col, `unknown page id(s) in this workspace: ${missing.join(", ")}`);
  return ids;
}

async function convertValue(ctx: McpContext, col: ColumnLite, value: unknown, workspaceId: string): Promise<unknown> {
  switch (col.type) {
    case "text":
    case "phone":
      return asString(col, value);
    case "url":
      return toUrl(col, value);
    case "email":
      return toEmail(col, value);
    case "number":
      return toNumber(col, value);
    case "checkbox":
      return toCheckbox(col, value);
    case "date":
      return toDate(col, value);
    case "select":
    case "status":
      return optionId(col, asString(col, value));
    case "multiSelect":
      return asList(col, value).map((v) => optionId(col, v));
    case "person":
      return Promise.all(asList(col, value).map((ref) => memberIdFor(ctx, col, ref, workspaceId)));
    case "pageLink":
      return pageLinkIds(ctx, col, asList(col, value), workspaceId);
    default:
      return fail(col, `this column type cannot be written via MCP (supported: ${SUPPORTED.join(", ")})`);
  }
}

/**
 * {columnNameOrId: value} → { cells, title }. value=null 은 셀 삭제(cells[colId]=undefined).
 * title 컬럼 값은 cells 가 아니라 title 로 돌려준다.
 */
export async function convertProperties(
  ctx: McpContext,
  db: Record<string, unknown>,
  props: Record<string, unknown>,
): Promise<ConvertedProperties> {
  const columns = parseColumns(db.columns);
  const workspaceId = String(db.workspaceId ?? "");
  const cells: Record<string, unknown> = {};
  let title: string | undefined;
  for (const [key, value] of Object.entries(props)) {
    const col = resolveColumn(columns, key);
    if (col.id in cells) throw new ToolError(`Property "${col.name}" is given more than once`);
    if (col.type === "title") {
      title = asString(col, value ?? "");
      continue;
    }
    cells[col.id] = value === null ? undefined : await convertValue(ctx, col, value, workspaceId);
  }
  return title === undefined ? { cells } : { cells, title };
}

/** 기존 dbCells 에 변환 결과를 합친 새 객체(undefined 는 키 삭제). */
export function mergeCells(existing: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...existing };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete next[k];
    else next[k] = v;
  }
  return next;
}
