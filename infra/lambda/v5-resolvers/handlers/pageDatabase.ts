import { Buffer } from "node:buffer";
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { v4 as uuid } from "uuid";

/** 휴지통 보관 기간 — listTrashedPages / restorePage / 만료 영구삭제와 동일하게 유지 */
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const TRASH_PAGE_MAX = 50;

/** DynamoDB Query 연속 조회 커서(EK + 동일 페이지 배열 내 skip) */
type TrashListCursor = {
  ek?: Record<string, unknown>;
  skip: number;
};

function encodeTrashCursor(c: TrashListCursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

function decodeTrashCursor(s: string | null | undefined): TrashListCursor | null {
  if (!s) return null;
  try {
    const o = JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as {
      ek?: Record<string, unknown>;
      skip?: number;
    };
    const skip = typeof o.skip === "number" && o.skip >= 0 ? o.skip : 0;
    return { ek: o.ek, skip };
  } catch {
    return null;
  }
}
import {
  badRequest,
  forbidden,
  getLCSchedulerWorkspaceIdFromDatabaseId,
  isLCSchedulerDatabaseId,
  notFound,
  requireWorkspaceAccess,
  type Member,
} from "./_auth";
import type { Tables } from "./member";
import { syncPageAssetUsage, cascadeDeletePageAssetUsage } from "./asset";
import {
  removeLCScheduleIndexForPage,
  syncLCScheduleIndexForPage,
} from "./lcScheduleIndex";

const PAGE_HISTORY_ANCHOR_INTERVAL = 20;
const DATABASE_HISTORY_ANCHOR_INTERVAL = 20;

type Connection<T> = { items: T[]; nextToken?: string | null };

type BaseRecord = {
  id: string;
  workspaceId: string;
  createdByMemberId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

const PAGE_HISTORY_FIELDS = [
  "id",
  "workspaceId",
  "createdByMemberId",
  "title",
  "icon",
  "coverImage",
  "parentId",
  "order",
  "databaseId",
  "doc",
  "dbCells",
  "blockComments",
  "createdAt",
  "updatedAt",
] as const;

const DATABASE_HISTORY_FIELDS = [
  "id",
  "workspaceId",
  "createdByMemberId",
  "title",
  "columns",
  "presets",
  "panelState",
  "createdAt",
  "updatedAt",
  "deletedAt",
] as const;

type PagePatchOp = {
  op: "set" | "unset";
  path: Array<string | number>;
  value?: unknown;
};

function cloneJson<T>(value: T): T {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizePageSnapshot(item: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of PAGE_HISTORY_FIELDS) {
    if (key in item) out[key] = cloneJson(item[key]);
  }
  return out;
}

function normalizeDatabaseSnapshot(item: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of DATABASE_HISTORY_FIELDS) {
    if (key in item) out[key] = cloneJson(item[key]);
  }
  return out;
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function diffValue(before: unknown, after: unknown, path: Array<string | number>, out: PagePatchOp[]): void {
  if (jsonEqual(before, after)) return;
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      if (!(key in after)) out.push({ op: "unset", path: [...path, key] });
      else diffValue(before[key], after[key], [...path, key], out);
    }
    return;
  }
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
    for (let i = 0; i < after.length; i += 1) {
      diffValue(before[i], after[i], [...path, i], out);
    }
    return;
  }
  out.push({ op: "set", path, value: cloneJson(after) });
}

function diffPageSnapshot(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): PagePatchOp[] {
  const patch: PagePatchOp[] = [];
  if (!before) {
    patch.push({ op: "set", path: [], value: normalizePageSnapshot(after) });
    return patch;
  }
  const normalizedBefore = normalizePageSnapshot(before);
  const normalizedAfter = normalizePageSnapshot(after);
  for (const key of PAGE_HISTORY_FIELDS) {
    if (!(key in normalizedAfter)) {
      if (key in normalizedBefore) patch.push({ op: "unset", path: [key] });
      continue;
    }
    diffValue(normalizedBefore[key], normalizedAfter[key], [key], patch);
  }
  return patch;
}

function diffDatabaseSnapshot(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): PagePatchOp[] {
  const patch: PagePatchOp[] = [];
  if (!before) {
    patch.push({ op: "set", path: [], value: normalizeDatabaseSnapshot(after) });
    return patch;
  }
  const normalizedBefore = normalizeDatabaseSnapshot(before);
  const normalizedAfter = normalizeDatabaseSnapshot(after);
  for (const key of DATABASE_HISTORY_FIELDS) {
    if (!(key in normalizedAfter)) {
      if (key in normalizedBefore) patch.push({ op: "unset", path: [key] });
      continue;
    }
    diffValue(normalizedBefore[key], normalizedAfter[key], [key], patch);
  }
  return patch;
}

function setPath(target: Record<string, unknown>, path: Array<string | number>, value: unknown): Record<string, unknown> {
  if (path.length === 0) return cloneJson(value as Record<string, unknown>);
  let cursor: unknown = target;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i]!;
    if (Array.isArray(cursor)) {
      const nextKey = path[i + 1];
      if (cursor[key as number] == null) cursor[key as number] = typeof nextKey === "number" ? [] : {};
      cursor = cursor[key as number];
    } else {
      const obj = cursor as Record<string, unknown>;
      const nextKey = path[i + 1];
      if (obj[key] == null) obj[key] = typeof nextKey === "number" ? [] : {};
      cursor = obj[key];
    }
  }
  const last = path[path.length - 1]!;
  if (Array.isArray(cursor)) cursor[last as number] = cloneJson(value);
  else (cursor as Record<string, unknown>)[last] = cloneJson(value);
  return target;
}

function unsetPath(target: Record<string, unknown>, path: Array<string | number>): void {
  if (path.length === 0) return;
  let cursor: unknown = target;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i]!;
    cursor = Array.isArray(cursor)
      ? cursor[key as number]
      : (cursor as Record<string, unknown>)[key];
    if (cursor == null) return;
  }
  const last = path[path.length - 1]!;
  if (Array.isArray(cursor)) cursor.splice(last as number, 1);
  else delete (cursor as Record<string, unknown>)[last];
}

function applyPagePatch(
  base: Record<string, unknown> | null,
  patch: PagePatchOp[],
): Record<string, unknown> | null {
  let next: Record<string, unknown> = base ? cloneJson(base) : {};
  for (const op of patch) {
    if (op.op === "set") next = setPath(next, op.path, op.value);
    else unsetPath(next, op.path);
  }
  return typeof next.id === "string" ? next : null;
}

function applyDatabasePatch(
  base: Record<string, unknown> | null,
  patch: PagePatchOp[],
): Record<string, unknown> | null {
  let next: Record<string, unknown> = base ? cloneJson(base) : {};
  for (const op of patch) {
    if (op.op === "set") next = setPath(next, op.path, op.value);
    else unsetPath(next, op.path);
  }
  return typeof next.id === "string" ? next : null;
}

function requireDatabaseHistoryOwnerKey(caller: Member): string {
  if (!caller.cognitoSub) forbidden("DB 히스토리 owner key 없음");
  return caller.cognitoSub;
}

async function listPageHistoryAsc(args: {
  doc: DynamoDBDocumentClient;
  tableName: string;
  pageId: string;
}): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const res = await args.doc.send(
      new QueryCommand({
        TableName: args.tableName,
        KeyConditionExpression: "pageId = :p",
        ExpressionAttributeValues: { ":p": args.pageId },
        ScanIndexForward: true,
        ExclusiveStartKey: startKey,
      }),
    );
    out.push(...((res.Items ?? []) as Array<Record<string, unknown>>));
    startKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);
  return out;
}

async function listDatabaseHistoryAsc(args: {
  doc: DynamoDBDocumentClient;
  tableName: string;
  databaseId: string;
}): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const res = await args.doc.send(
      new QueryCommand({
        TableName: args.tableName,
        KeyConditionExpression: "databaseId = :d",
        ExpressionAttributeValues: { ":d": args.databaseId },
        ScanIndexForward: true,
        ExclusiveStartKey: startKey,
      }),
    );
    out.push(...((res.Items ?? []) as Array<Record<string, unknown>>));
    startKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);
  return out;
}

async function recordPageHistory(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  kind: string;
}): Promise<void> {
  const tableName = args.tables.PageHistory;
  if (!tableName) return;
  const pageId = typeof args.after.id === "string" ? args.after.id : null;
  const workspaceId = typeof args.after.workspaceId === "string" ? args.after.workspaceId : null;
  if (!pageId || !workspaceId) return;
  // row 페이지(=databaseId 보유)는 byDatabaseAndCreatedAt GSI 색인용으로 databaseId 를 함께 저장한다.
  const rowDatabaseId =
    typeof args.after.databaseId === "string" && args.after.databaseId
      ? args.after.databaseId
      : null;
  const history = await listPageHistoryAsc({ doc: args.doc, tableName, pageId });
  const afterSnap = normalizePageSnapshot(args.after);
  const isFirstEver = history.length === 0;
  // 히스토리가 0건인 페이지는 변경 유무와 무관하게 최초 1건을 베이스라인으로 기록한다.
  // (기능 도입 이전에 생성됐거나, 첫 upsert 가 기록 경로를 못 탔던 페이지의 버전 보정.)
  const patch = isFirstEver
    ? diffPageSnapshot(null, afterSnap)
    : diffPageSnapshot(args.before ? normalizePageSnapshot(args.before) : null, afterSnap);
  if (patch.length === 0) return;
  const createdAt = new Date().toISOString();
  const shouldWriteAnchor = isFirstEver || history.length % PAGE_HISTORY_ANCHOR_INTERVAL === 0;
  // 최초 베이스라인은 "페이지 생성"으로 표기하고 현재 전체 스냅샷을 anchor 로 남긴다.
  const kind = isFirstEver ? "page.create" : args.kind;
  const anchorSnap = isFirstEver ? afterSnap : normalizePageSnapshot(args.before ?? args.after);
  await args.doc.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        pageId,
        historyId: `${createdAt}#${uuid()}`,
        workspaceId,
        ...(rowDatabaseId ? { databaseId: rowDatabaseId } : {}),
        kind,
        patch,
        ...(shouldWriteAnchor ? { anchor: anchorSnap } : {}),
        createdAt,
        createdByMemberId: args.caller.memberId,
        createdByName: args.caller.name,
      },
    }),
  );
}

/** 행/페이지 soft delete 를 히스토리에 명시적으로 남긴다.
 *  (deletedAt 은 스냅샷 diff 로 잡히지 않으므로 일반 recordPageHistory 로는 기록되지 않는다.) */
async function recordPageDeleteHistory(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  deleted: Record<string, unknown>;
}): Promise<void> {
  const tableName = args.tables.PageHistory;
  if (!tableName) return;
  const pageId = typeof args.deleted.id === "string" ? args.deleted.id : null;
  const workspaceId =
    typeof args.deleted.workspaceId === "string" ? args.deleted.workspaceId : null;
  if (!pageId || !workspaceId) return;
  const rowDatabaseId =
    typeof args.deleted.databaseId === "string" && args.deleted.databaseId
      ? args.deleted.databaseId
      : null;
  const createdAt = new Date().toISOString();
  const deletedAt =
    typeof args.deleted.deletedAt === "string" ? args.deleted.deletedAt : createdAt;
  await args.doc.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        pageId,
        historyId: `${createdAt}#${uuid()}`,
        workspaceId,
        ...(rowDatabaseId ? { databaseId: rowDatabaseId } : {}),
        kind: "page.delete",
        patch: [{ op: "set", path: ["deletedAt"], value: deletedAt }],
        createdAt,
        createdByMemberId: args.caller.memberId,
        createdByName: args.caller.name,
      },
    }),
  );
}

async function recordDatabaseHistory(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  kind: string;
}): Promise<void> {
  const tableName = args.tables.DatabaseHistory;
  if (!tableName) return;
  const ownerId = requireDatabaseHistoryOwnerKey(args.caller);
  const databaseId = typeof args.after.id === "string" ? args.after.id : null;
  const workspaceId = typeof args.after.workspaceId === "string" ? args.after.workspaceId : null;
  if (!databaseId || !workspaceId) return;
  const history = await listDatabaseHistoryAsc({ doc: args.doc, tableName, databaseId });
  const afterSnap = normalizeDatabaseSnapshot(args.after);
  const isFirstEver = history.length === 0;
  const patch = isFirstEver
    ? diffDatabaseSnapshot(null, afterSnap)
    : diffDatabaseSnapshot(args.before ? normalizeDatabaseSnapshot(args.before) : null, afterSnap);
  if (patch.length === 0) return;
  const createdAt = new Date().toISOString();
  const shouldWriteAnchor = isFirstEver || history.length % DATABASE_HISTORY_ANCHOR_INTERVAL === 0;
  const kind = isFirstEver ? "database.create" : args.kind;
  const anchorSnap = isFirstEver ? afterSnap : normalizeDatabaseSnapshot(args.before ?? args.after);
  await args.doc.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        databaseId,
        historyId: `${createdAt}#${uuid()}`,
        workspaceId,
        ownerId,
        kind,
        patch,
        ...(shouldWriteAnchor ? { anchor: anchorSnap } : {}),
        createdAt,
        createdByMemberId: args.caller.memberId,
        createdByName: args.caller.name,
      },
    }),
  );
}

export async function listPages(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  workspaceId: string;
  updatedAfter?: string;
  limit?: number;
  nextToken?: string;
}): Promise<Connection<Record<string, unknown>>> {
  if (!args.tables.Pages) badRequest("Pages table 미설정");
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "view",
  });
  const query = args.updatedAfter
    ? {
        expression: "workspaceId = :w AND updatedAt > :u",
        expressionValues: { ":w": args.workspaceId, ":u": args.updatedAfter },
      }
    : {
        expression: "workspaceId = :w",
        expressionValues: { ":w": args.workspaceId },
      };
  const r = await args.doc.send(
    new QueryCommand({
      TableName: args.tables.Pages,
      IndexName: "byWorkspaceAndUpdatedAt",
      KeyConditionExpression: query.expression,
      ExpressionAttributeValues: query.expressionValues,
      Limit: args.limit ?? 100,
      ExclusiveStartKey: args.nextToken ? JSON.parse(args.nextToken) : undefined,
    }),
  );
  return {
    items: (r.Items ?? []) as Record<string, unknown>[],
    nextToken: r.LastEvaluatedKey ? JSON.stringify(r.LastEvaluatedKey) : null,
  };
}

export async function listDatabases(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  workspaceId: string;
  updatedAfter?: string;
  limit?: number;
  nextToken?: string;
}): Promise<Connection<Record<string, unknown>>> {
  if (!args.tables.Databases) badRequest("Databases table 미설정");
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "view",
  });
  const query = args.updatedAfter
    ? {
        expression: "workspaceId = :w AND updatedAt > :u",
        expressionValues: { ":w": args.workspaceId, ":u": args.updatedAfter },
      }
    : {
        expression: "workspaceId = :w",
        expressionValues: { ":w": args.workspaceId },
      };
  const r = await args.doc.send(
    new QueryCommand({
      TableName: args.tables.Databases,
      IndexName: "byWorkspaceAndUpdatedAt",
      KeyConditionExpression: query.expression,
      ExpressionAttributeValues: query.expressionValues,
      Limit: args.limit ?? 100,
      ExclusiveStartKey: args.nextToken ? JSON.parse(args.nextToken) : undefined,
    }),
  );
  return {
    items: (r.Items ?? []) as Record<string, unknown>[],
    nextToken: r.LastEvaluatedKey ? JSON.stringify(r.LastEvaluatedKey) : null,
  };
}

async function upsertRecord(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  tableName: string;
  input: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const input = args.input as unknown as BaseRecord;
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: input.workspaceId,
    required: "edit",
  });
  await args.doc.send(
    new PutCommand({
      TableName: args.tableName,
      Item: {
        ...args.input,
        createdByMemberId: input.createdByMemberId || args.caller.memberId,
      },
    }),
  );
  return args.input;
}

/** data URL·base64 커버가 DynamoDB 400KB 항목 한도를 압박하지 않도록 상한(문자열 length 기준). */
const MAX_COVER_IMAGE_CHARS = 350_000;

function validateCoverImageField(input: Record<string, unknown>): void {
  const v = input.coverImage;
  if (v == null) return;
  if (typeof v !== "string") badRequest("coverImage 는 문자열이어야 합니다");
  if (v.length > MAX_COVER_IMAGE_CHARS) {
    badRequest(
      `커버 이미지 데이터가 너무 큽니다(최대 약 ${MAX_COVER_IMAGE_CHARS}자). 더 작은 이미지를 사용해 주세요.`,
    );
  }
}

/** 댓글 JSON 이 DynamoDB 항목 한도를 압박하지 않도록 상한(문자열 length 기준). */
const MAX_BLOCK_COMMENTS_JSON_CHARS = 280_000;

/**
 * AppSync 가 AWSJSON 을 Lambda 에 **이미 파싱된 객체**로 넘기는 경우가 있어
 * 문자열뿐 아니라 plain object/array 를 받아 문자열로 정규화한다.
 * 클라이언트가 JSON 문자열로내도 동일하게 처리된다.
 */
function normalizeAwsJsonStringField(
  input: Record<string, unknown>,
  fieldName: string,
  label: string,
): void {
  const value = input[fieldName];
  if (value == null) return;

  if (typeof value === "string") return;
  if (typeof value !== "object") {
    badRequest(`${label} 는 JSON 객체·배열·문자열·null 이어야 합니다`);
  }

  try {
    input[fieldName] = JSON.stringify(value);
  } catch {
    badRequest(`${label} JSON 직렬화에 실패했습니다`);
  }
}

function normalizeDatabaseAwsJsonFields(input: Record<string, unknown>): void {
  normalizeAwsJsonStringField(input, "columns", "columns");
  normalizeAwsJsonStringField(input, "presets", "presets");
  normalizeAwsJsonStringField(input, "panelState", "panelState");
}

const MAX_SYNCED_SCHEDULER_MEMBER_ORDER = 1000;
const MAX_SYNCED_ID_CHARS = 128;

function parsePanelStateObject(raw: unknown): Record<string, unknown> | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return isPlainObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isPlainObject(raw) ? raw : null;
}

function sanitizeSyncedStringArray(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length > MAX_SYNCED_SCHEDULER_MEMBER_ORDER) {
    badRequest("동기화 목록 최대 개수 초과");
  }
  const result = raw.map(String);
  for (const id of result) {
    if (id.length > MAX_SYNCED_ID_CHARS) badRequest("동기화 ID 길이 초과");
  }
  return result;
}

function mergeStaleSchedulerMemberOrderPanelState(
  databaseId: string,
  input: Record<string, unknown>,
  existingItem: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!isLCSchedulerDatabaseId(databaseId)) return null;

  const incomingPanelState = parsePanelStateObject(input.panelState);
  if (!incomingPanelState) return null;
  const incomingUpdatedAt = Number(incomingPanelState.schedulerMemberOrderUpdatedAt);
  if (!Number.isFinite(incomingUpdatedAt) || incomingUpdatedAt < 0) return null;

  const existingPanelState = parsePanelStateObject(existingItem.panelState) ?? {};
  const existingUpdatedAt = Number(existingPanelState.schedulerMemberOrderUpdatedAt);
  const currentUpdatedAt = Number.isFinite(existingUpdatedAt) ? existingUpdatedAt : -1;
  const incomingOrder = sanitizeSyncedStringArray(incomingPanelState.schedulerMemberOrder) ?? [];
  const existingOrder = sanitizeSyncedStringArray(existingPanelState.schedulerMemberOrder) ?? [];
  const shouldMerge =
    incomingUpdatedAt > currentUpdatedAt ||
    (incomingUpdatedAt === currentUpdatedAt && !jsonEqual(incomingOrder, existingOrder));
  if (!shouldMerge) return null;

  return {
    ...existingItem,
    panelState: JSON.stringify({
      ...existingPanelState,
      schedulerMemberOrder: incomingOrder,
      schedulerMemberOrderUpdatedAt: incomingUpdatedAt,
    }),
  };
}

function normalizeBlockCommentsField(input: Record<string, unknown>): void {
  const v = input.blockComments;
  if (v == null) return;
  let asString: string;
  if (typeof v === "string") {
    asString = v;
  } else if (typeof v === "object") {
    try {
      asString = JSON.stringify(v);
    } catch {
      badRequest("blockComments JSON 직렬화에 실패했습니다");
    }
  } else {
    badRequest("blockComments 는 JSON 객체·문자열·null 이어야 합니다");
  }
  if (asString.length > MAX_BLOCK_COMMENTS_JSON_CHARS) {
    badRequest(
      `블록 댓글 데이터가 너무 큽니다(최대 약 ${MAX_BLOCK_COMMENTS_JSON_CHARS}자). 오래된 스레드를 정리해 주세요.`,
    );
  }
  input.blockComments = asString;
}

export async function upsertPage(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  input: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  if (!args.tables.Pages) badRequest("Pages table 미설정");
  const input: Record<string, unknown> = { ...args.input };
  let existingPage: Record<string, unknown> | null = null;
  if (typeof input.id === "string") {
    const existing = await args.doc.send(
      new GetCommand({ TableName: args.tables.Pages, Key: { id: input.id } }),
    );
    existingPage = (existing.Item as Record<string, unknown> | undefined) ?? null;
  }
  // 구 클라이언트가 blockComments 키를 빼고 Put 하면 Dynamo 항목에서 댓글이 사라진다.
  // 키가 없을 때만 기존 값을 이어붙인다(null 은 의도적 삭제로 본다).
  if (!("blockComments" in input)) {
    const prev = existingPage?.blockComments;
    if (prev != null) {
      input.blockComments = prev;
    }
  }
  validateCoverImageField(input);
  normalizeBlockCommentsField(input);
  const saved = await upsertRecord({ ...args, tableName: args.tables.Pages, input });
  try {
    await recordPageHistory({
      doc: args.doc,
      tables: args.tables,
      caller: args.caller,
      before: existingPage,
      after: saved,
      kind: existingPage ? "page.update" : "page.create",
    });
  } catch (err) {
    console.error("[upsertPage] PageHistory 기록 실패 (무시)", err);
  }
  // 자산 사용 위치 인덱스 동기화 — doc 내부 ref 들을 AssetUsage 테이블에 반영.
  // 실패해도 페이지 저장 자체는 성공으로 응답 (인덱스는 보조 데이터).
  // cognitoSub 가 없으면 (legacy member) sync 스킵 — 자산 소유자 매핑 불가.
  if (args.caller.cognitoSub) {
    try {
      await syncPageAssetUsage({
        doc: args.doc,
        tables: args.tables,
        ownerId: args.caller.cognitoSub,
        workspaceId: typeof saved.workspaceId === "string" ? saved.workspaceId : (typeof input.workspaceId === "string" ? input.workspaceId : ""),
        pageId: typeof saved.id === "string" ? saved.id : (typeof input.id === "string" ? input.id : ""),
        pageTitle: typeof saved.title === "string" ? saved.title : null,
        pageDoc: saved.doc ?? input.doc,
        pageIcon: typeof saved.icon === "string" ? saved.icon : (typeof input.icon === "string" ? input.icon : null),
        pageCoverImage: typeof saved.coverImage === "string" ? saved.coverImage : (typeof input.coverImage === "string" ? input.coverImage : null),
        // DB 행의 파일 컬럼(FileCellItem[]) 까지 인덱싱 — extractAssetRefs 만으로는 dbCells 가
        // doc 트리 바깥이라 탐지되지 않아 모든 첨부가 "사용 안 됨" 으로 잘못 분류되던 버그 차단.
        pageDbCells: saved.dbCells ?? input.dbCells,
      });
    } catch (err) {
      console.error("[upsertPage] AssetUsage sync 실패 (무시)", err);
    }
  }
  try {
    await syncLCScheduleIndexForPage({
      doc: args.doc,
      tables: args.tables,
      before: existingPage,
      after: saved,
    });
  } catch (err) {
    console.error("[upsertPage] LC schedule index sync failed", err);
  }
  return saved;
}

export async function upsertDatabase(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  input: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  if (!args.tables.Databases) badRequest("Databases table 미설정");
  const id = typeof args.input.id === "string" ? args.input.id : "";
  const workspaceId = typeof args.input.workspaceId === "string" ? args.input.workspaceId : "";
  const schedulerWorkspaceId = getLCSchedulerWorkspaceIdFromDatabaseId(id);
  if (schedulerWorkspaceId && schedulerWorkspaceId !== workspaceId) {
    badRequest("LC스케줄러 DB ID와 워크스페이스가 일치하지 않습니다");
  }
  normalizeDatabaseAwsJsonFields(args.input);

  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId,
    required: "edit",
  });
  if (args.tables.DatabaseHistory) requireDatabaseHistoryOwnerKey(args.caller);

  const tableName = args.tables.Databases;
  const incomingUpdatedAt =
    typeof args.input.updatedAt === "string" ? args.input.updatedAt : "";

  // 기존 레코드 조회 — LWW 비교 및 부분 payload 병합(생략 필드 보존)용.
  const existing = await args.doc.send(
    new GetCommand({ TableName: tableName, Key: { id } }),
  );
  const existingItem = existing.Item as Record<string, unknown> | undefined;
  const existingUpdatedAt =
    typeof existingItem?.updatedAt === "string" ? (existingItem.updatedAt as string) : "";

  // LWW: 들어온 변경이 서버 최신값보다 오래됐거나 같으면 무시하고 기존값을 반환한다.
  // (ISO 8601 문자열은 사전식 비교 = 시간순 비교. 시드의 옛 타임스탬프·중복 echo 를 거른다.)
  if (existingItem && existingUpdatedAt && incomingUpdatedAt && incomingUpdatedAt <= existingUpdatedAt) {
    const schedulerOrderMerge = mergeStaleSchedulerMemberOrderPanelState(
      id,
      args.input,
      existingItem,
    );
    if (schedulerOrderMerge) {
      try {
        await args.doc.send(
          new PutCommand({
            TableName: tableName,
            Item: schedulerOrderMerge,
            ConditionExpression: "updatedAt = :existingUpdatedAt",
            ExpressionAttributeValues: { ":existingUpdatedAt": existingUpdatedAt },
          }),
        );
        try {
          await recordDatabaseHistory({
            doc: args.doc,
            tables: args.tables,
            caller: args.caller,
            before: existingItem,
            after: schedulerOrderMerge,
            kind: "database.update",
          });
        } catch (err) {
          console.error("[upsertDatabase] DatabaseHistory 기록 실패 (무시)", err);
        }
        return schedulerOrderMerge;
      } catch (err) {
        if ((err as { name?: string })?.name === "ConditionalCheckFailedException") {
          const latest = await args.doc.send(
            new GetCommand({ TableName: tableName, Key: { id } }),
          );
          return (latest.Item ?? existingItem) as Record<string, unknown>;
        }
        throw err;
      }
    }
    return existingItem;
  }

  // 부분 payload 가 기존 필드(panelState 등)를 지우지 않도록 기존값 위에 병합한다.
  // 과거 blind PutItem 은 panelState 가 생략되면 서버 표시설정을 통째로 삭제했다.
  const merged: Record<string, unknown> = {
    ...(existingItem ?? {}),
    ...args.input,
    // 최초 생성 메타는 보존한다.
    createdAt: existingItem?.createdAt ?? args.input.createdAt,
    createdByMemberId:
      (existingItem?.createdByMemberId as string | undefined) ||
      (args.input.createdByMemberId as string | undefined) ||
      args.caller.memberId,
  };

  try {
    await args.doc.send(
      new PutCommand({
        TableName: tableName,
        Item: merged,
        // 조회~쓰기 사이 경쟁 보호 — 그 사이 더 최신 쓰기가 들어왔으면 거부.
        ConditionExpression: "attribute_not_exists(updatedAt) OR updatedAt <= :incoming",
        ExpressionAttributeValues: { ":incoming": incomingUpdatedAt },
      }),
    );
  } catch (err) {
    if ((err as { name?: string })?.name === "ConditionalCheckFailedException") {
      // 경쟁 중 더 최신 쓰기가 선반영됨 → 최신 서버값을 반환(이 쓰기는 stale 로 폐기).
      const latest = await args.doc.send(
        new GetCommand({ TableName: tableName, Key: { id } }),
      );
      return (latest.Item ?? existingItem ?? merged) as Record<string, unknown>;
    }
    throw err;
  }
  try {
    await recordDatabaseHistory({
      doc: args.doc,
      tables: args.tables,
      caller: args.caller,
      before: existingItem ?? null,
      after: merged,
      kind: existingItem ? "database.update" : "database.create",
    });
  } catch (err) {
    console.error("[upsertDatabase] DatabaseHistory 기록 실패 (무시)", err);
  }
  return merged;
}

async function softDeleteRecord(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  tableName: string;
  id: string;
  workspaceId: string;
  updatedAt: string;
}): Promise<Record<string, unknown>> {
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "edit",
  });
  const existing = await args.doc.send(
    new GetCommand({ TableName: args.tableName, Key: { id: args.id } }),
  );
  if (!existing.Item) notFound("리소스 없음");
  const now = new Date().toISOString();
  const r = await args.doc.send(
    new UpdateCommand({
      TableName: args.tableName,
      Key: { id: args.id },
      UpdateExpression: "SET deletedAt = :d, updatedAt = :u",
      ExpressionAttributeValues: {
        ":d": now,
        ":u": now,
        ":old": args.updatedAt,
        ":w": args.workspaceId,
      },
      ConditionExpression: "workspaceId = :w AND (attribute_not_exists(updatedAt) OR updatedAt <= :old)",
      ReturnValues: "ALL_NEW",
    }),
  );
  return (r.Attributes ?? {}) as Record<string, unknown>;
}

export async function softDeletePage(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  id: string;
  workspaceId: string;
  updatedAt: string;
}): Promise<Record<string, unknown>> {
  if (!args.tables.Pages) badRequest("Pages table 미설정");
  const deleted = await softDeleteRecord({ ...args, tableName: args.tables.Pages });
  try {
    await recordPageDeleteHistory({
      doc: args.doc,
      tables: args.tables,
      caller: args.caller,
      deleted,
    });
  } catch (err) {
    console.error("[softDeletePage] PageHistory 기록 실패 (무시)", err);
  }
  try {
    await removeLCScheduleIndexForPage({
      doc: args.doc,
      tables: args.tables,
      page: deleted,
    });
  } catch (err) {
    console.error("[softDeletePage] LC schedule index remove failed", err);
  }
  return deleted;
}

export async function softDeleteDatabase(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  id: string;
  workspaceId: string;
  updatedAt: string;
}): Promise<Record<string, unknown>> {
  if (!args.tables.Databases) badRequest("Databases table 미설정");
  if (isLCSchedulerDatabaseId(args.id)) {
    forbidden("LC스케줄러 데이터베이스는 삭제할 수 없습니다");
  }
  if (args.tables.DatabaseHistory) requireDatabaseHistoryOwnerKey(args.caller);
  const existing = await args.doc.send(
    new GetCommand({ TableName: args.tables.Databases, Key: { id: args.id } }),
  );
  const before = (existing.Item as Record<string, unknown> | undefined) ?? null;
  const deleted = await softDeleteRecord({ ...args, tableName: args.tables.Databases });
  try {
    await recordDatabaseHistory({
      doc: args.doc,
      tables: args.tables,
      caller: args.caller,
      before,
      after: deleted,
      kind: "database.delete",
    });
  } catch (err) {
    console.error("[softDeleteDatabase] DatabaseHistory 기록 실패 (무시)", err);
  }
  return deleted;
}

export async function permanentlyDeleteDatabase(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  id: string;
  workspaceId: string;
}): Promise<boolean> {
  if (!args.tables.Databases) badRequest("Databases table 미설정");
  if (isLCSchedulerDatabaseId(args.id)) {
    forbidden("LC스케줄러 데이터베이스는 영구삭제할 수 없습니다");
  }
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "edit",
  });
  if (args.tables.DatabaseHistory) requireDatabaseHistoryOwnerKey(args.caller);
  const existing = await args.doc.send(
    new GetCommand({ TableName: args.tables.Databases, Key: { id: args.id } }),
  );
  if (!existing.Item) return true;
  if (existing.Item["workspaceId"] !== args.workspaceId) {
    forbidden("다른 워크스페이스의 데이터베이스는 영구삭제할 수 없습니다");
  }
  await args.doc.send(
    new DeleteCommand({
      TableName: args.tables.Databases,
      Key: { id: args.id },
    }),
  );

  if (args.tables.Pages) {
    const rowPageIds = new Set<string>();
    let pageStartKey: Record<string, unknown> | undefined;
    do {
      const r = await args.doc.send(
        new QueryCommand({
          TableName: args.tables.Pages,
          IndexName: "byWorkspaceAndUpdatedAt",
          KeyConditionExpression: "workspaceId = :w",
          FilterExpression: "databaseId = :db",
          ExpressionAttributeValues: {
            ":w": args.workspaceId,
            ":db": args.id,
          },
          ProjectionExpression: "id",
          Limit: 100,
          ExclusiveStartKey: pageStartKey,
        }),
      );
      const items = (r.Items ?? []) as Array<{ id?: unknown }>;
      for (const item of items) {
        if (typeof item.id !== "string") continue;
        rowPageIds.add(item.id);
        await args.doc.send(
          new DeleteCommand({
            TableName: args.tables.Pages,
            Key: { id: item.id },
            ConditionExpression: "workspaceId = :w",
            ExpressionAttributeValues: { ":w": args.workspaceId },
          }),
        );
        try {
          await cascadeDeletePageAssetUsage({ doc: args.doc, tables: args.tables, pageId: item.id });
        } catch (err) {
          console.error("[permanentlyDeleteDatabase] AssetUsage cascade 실패 (무시)", { pageId: item.id, err });
        }
      }
      pageStartKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (pageStartKey);

    if (args.tables.Comments && rowPageIds.size > 0) {
      let commentStartKey: Record<string, unknown> | undefined;
      do {
        const r = await args.doc.send(
          new QueryCommand({
            TableName: args.tables.Comments,
            IndexName: "byWorkspaceAndUpdatedAt",
            KeyConditionExpression: "workspaceId = :w",
            ExpressionAttributeValues: { ":w": args.workspaceId },
            ProjectionExpression: "id, pageId",
            Limit: 100,
            ExclusiveStartKey: commentStartKey,
          }),
        );
        const comments = (r.Items ?? []) as Array<{ id?: unknown; pageId?: unknown }>;
        await Promise.all(
          comments
            .filter((item) => typeof item.id === "string" && typeof item.pageId === "string" && rowPageIds.has(item.pageId))
            .map(async (item) => {
              await args.doc.send(
                new DeleteCommand({
                  TableName: args.tables.Comments!,
                  Key: { id: item.id },
                  ConditionExpression: "workspaceId = :w",
                  ExpressionAttributeValues: { ":w": args.workspaceId },
                }),
              );
            }),
        );
        commentStartKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (commentStartKey);
    }
  }
  if (args.tables.DatabaseHistory) {
    const history = (await listDatabaseHistoryAsc({
      doc: args.doc,
      tableName: args.tables.DatabaseHistory,
      databaseId: args.id,
    })).filter((item) => item.workspaceId === args.workspaceId);
    for (let i = 0; i < history.length; i += 25) {
      const chunk = history.slice(i, i + 25);
      await args.doc.send(
        new BatchWriteCommand({
          RequestItems: {
            [args.tables.DatabaseHistory]: chunk.map((item) => ({
              DeleteRequest: { Key: { databaseId: args.id, historyId: item.historyId } },
            })),
          },
        }),
      );
    }
  }
  return true;
}

/**
 * 휴지통의 단일 페이지를 영구 삭제. soft-deleted(deletedAt 존재) 상태일 때만 허용.
 * 휴지통 비우기를 클라이언트에서 청크 단위로 처리하면서 진행률을 보여주기 위해 사용.
 */
export async function permanentlyDeletePage(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  id: string;
  workspaceId: string;
}): Promise<boolean> {
  if (!args.tables.Pages) badRequest("Pages table 미설정");
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "edit",
  });
  const existing = await args.doc.send(
    new GetCommand({ TableName: args.tables.Pages, Key: { id: args.id } }),
  );
  if (!existing.Item) return true;
  if (existing.Item["workspaceId"] !== args.workspaceId) {
    forbidden("다른 워크스페이스의 페이지는 영구삭제할 수 없습니다");
  }
  if (!existing.Item["deletedAt"]) {
    forbidden("휴지통에 없는 페이지는 영구삭제할 수 없습니다");
  }
  await args.doc.send(
    new DeleteCommand({
      TableName: args.tables.Pages,
      Key: { id: args.id },
      ConditionExpression: "workspaceId = :w",
      ExpressionAttributeValues: { ":w": args.workspaceId },
    }),
  );

  // 자산 사용 인덱스 cascade — 삭제된 페이지를 가리키는 모든 AssetUsage row 제거.
  try {
    await cascadeDeletePageAssetUsage({ doc: args.doc, tables: args.tables, pageId: args.id });
  } catch (err) {
    console.error("[permanentlyDeletePage] AssetUsage cascade 실패 (무시)", err);
  }

  // 연관 코멘트 정리 — 페이지 ID 매칭 row 만 제거
  if (args.tables.Comments) {
    let commentStartKey: Record<string, unknown> | undefined;
    do {
      const r = await args.doc.send(
        new QueryCommand({
          TableName: args.tables.Comments,
          IndexName: "byWorkspaceAndUpdatedAt",
          KeyConditionExpression: "workspaceId = :w",
          ExpressionAttributeValues: { ":w": args.workspaceId },
          ProjectionExpression: "id, pageId",
          Limit: 100,
          ExclusiveStartKey: commentStartKey,
        }),
      );
      const comments = (r.Items ?? []) as Array<{ id?: unknown; pageId?: unknown }>;
      await Promise.all(
        comments
          .filter(
            (item) =>
              typeof item.id === "string" &&
              typeof item.pageId === "string" &&
              item.pageId === args.id,
          )
          .map(async (item) => {
            await args.doc.send(
              new DeleteCommand({
                TableName: args.tables.Comments!,
                Key: { id: item.id },
                ConditionExpression: "workspaceId = :w",
                ExpressionAttributeValues: { ":w": args.workspaceId },
              }),
            );
          }),
      );
      commentStartKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (commentStartKey);
  }
  return true;
}

export async function emptyTrash(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  workspaceId: string;
}): Promise<number> {
  if (!args.tables.Pages) badRequest("Pages table 미설정");
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "edit",
  });

  const deletedPageIds = new Set<string>();
  let pageStartKey: Record<string, unknown> | undefined;
  do {
    const r = await args.doc.send(
      new QueryCommand({
        TableName: args.tables.Pages,
        IndexName: "byWorkspaceAndUpdatedAt",
        KeyConditionExpression: "workspaceId = :w",
        ExpressionAttributeValues: { ":w": args.workspaceId },
        FilterExpression: "attribute_exists(deletedAt)",
        ProjectionExpression: "id",
        Limit: 100,
        ExclusiveStartKey: pageStartKey,
      }),
    );
    const items = (r.Items ?? []) as Array<{ id?: unknown }>;
    await Promise.all(
      items
        .map((item) => (typeof item.id === "string" ? item.id : null))
        .filter((id): id is string => !!id)
        .map(async (id) => {
          deletedPageIds.add(id);
          await args.doc.send(
            new DeleteCommand({
              TableName: args.tables.Pages,
              Key: { id },
              ConditionExpression: "workspaceId = :w",
              ExpressionAttributeValues: { ":w": args.workspaceId },
            }),
          );
        }),
    );
    pageStartKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (pageStartKey);

  // 자산 사용 인덱스 cascade — 휴지통에서 삭제된 모든 페이지의 AssetUsage row 제거.
  for (const pageId of deletedPageIds) {
    try {
      await cascadeDeletePageAssetUsage({ doc: args.doc, tables: args.tables, pageId });
    } catch (err) {
      console.error("[emptyTrash] AssetUsage cascade 실패 (무시)", { pageId, err });
    }
  }

  if (args.tables.Comments && deletedPageIds.size > 0) {
    let commentStartKey: Record<string, unknown> | undefined;
    do {
      const r = await args.doc.send(
        new QueryCommand({
          TableName: args.tables.Comments,
          IndexName: "byWorkspaceAndUpdatedAt",
          KeyConditionExpression: "workspaceId = :w",
          ExpressionAttributeValues: { ":w": args.workspaceId },
          ProjectionExpression: "id, pageId",
          Limit: 100,
          ExclusiveStartKey: commentStartKey,
        }),
      );
      const comments = (r.Items ?? []) as Array<{ id?: unknown; pageId?: unknown }>;
      await Promise.all(
        comments
          .filter((item) => typeof item.id === "string" && typeof item.pageId === "string" && deletedPageIds.has(item.pageId))
          .map(async (item) => {
            await args.doc.send(
              new DeleteCommand({
                TableName: args.tables.Comments!,
                Key: { id: item.id },
                ConditionExpression: "workspaceId = :w",
                ExpressionAttributeValues: { ":w": args.workspaceId },
              }),
            );
          }),
      );
      commentStartKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (commentStartKey);
  }

  return deletedPageIds.size;
}

/** 삭제됐지만 보관 기간 내인 페이지만, 삭제 시각 최신순 정렬·페이지당 최대 TRASH_PAGE_MAX 건 */
export async function listTrashedPages(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  workspaceId: string;
  limit?: number;
  nextToken?: string | null;
}): Promise<Connection<Record<string, unknown>>> {
  if (!args.tables.Pages) badRequest("Pages table 미설정");
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "view",
  });
  const cutoffIso = new Date(Date.now() - TRASH_RETENTION_MS).toISOString();
  const pageSize = Math.min(Math.max(args.limit ?? TRASH_PAGE_MAX, 1), TRASH_PAGE_MAX);
  const parsed = decodeTrashCursor(args.nextToken ?? undefined);
  const collected: Record<string, unknown>[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined = parsed?.ek;
  let itemSkip = parsed?.skip ?? 0;

  let iterations = 0;
  while (collected.length < pageSize && iterations < 100) {
    iterations += 1;
    const queryStartKey = exclusiveStartKey;
    const r = await args.doc.send(
      new QueryCommand({
        TableName: args.tables.Pages,
        IndexName: "byWorkspaceAndDeletedAt",
        KeyConditionExpression: "workspaceId = :w AND deletedAt > :cutoff",
        ExpressionAttributeValues: {
          ":w": args.workspaceId,
          ":cutoff": cutoffIso,
        },
        Limit: 100,
        ScanIndexForward: false,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    const batch = (r.Items ?? []) as Record<string, unknown>[];
    let i = itemSkip;
    itemSkip = 0;
    for (; i < batch.length && collected.length < pageSize; i++) {
      collected.push(batch[i]!);
    }
    if (collected.length >= pageSize) {
      collected.sort((a, b) =>
        String(b["deletedAt"] ?? "").localeCompare(String(a["deletedAt"] ?? "")),
      );
      let nextTok: string | null = null;
      if (i < batch.length) {
        nextTok = encodeTrashCursor({ ek: queryStartKey, skip: i });
      } else if (r.LastEvaluatedKey) {
        nextTok = encodeTrashCursor({
          ek: r.LastEvaluatedKey as Record<string, unknown>,
          skip: 0,
        });
      }
      return { items: collected, nextToken: nextTok };
    }
    if (!r.LastEvaluatedKey) {
      collected.sort((a, b) =>
        String(b["deletedAt"] ?? "").localeCompare(String(a["deletedAt"] ?? "")),
      );
      return { items: collected, nextToken: null };
    }
    exclusiveStartKey = r.LastEvaluatedKey as Record<string, unknown>;
  }
  collected.sort((a, b) =>
    String(b["deletedAt"] ?? "").localeCompare(String(a["deletedAt"] ?? "")),
  );
  return { items: collected, nextToken: null };
}

export async function restorePage(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  id: string;
  workspaceId: string;
}): Promise<Record<string, unknown>> {
  if (!args.tables.Pages) badRequest("Pages table 미설정");
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "edit",
  });
  const existing = await args.doc.send(
    new GetCommand({
      TableName: args.tables.Pages,
      Key: { id: args.id },
    }),
  );
  const item = existing.Item as Record<string, unknown> | undefined;
  if (!item) notFound("페이지 없음");
  if (String(item["workspaceId"]) !== args.workspaceId) {
    badRequest("워크스페이스가 일치하지 않습니다");
  }
  if (item["deletedAt"] == null || item["deletedAt"] === "") {
    badRequest("삭제되지 않은 페이지입니다");
  }
  const deletedMs = Date.parse(String(item["deletedAt"]));
  if (Number.isNaN(deletedMs)) badRequest("삭제 일시가 올바르지 않습니다");
  if (deletedMs < Date.now() - TRASH_RETENTION_MS) {
    badRequest("보관 기간이 지나 복원할 수 없습니다");
  }
  const next: Record<string, unknown> = { ...item };
  delete next["deletedAt"];
  next["updatedAt"] = new Date().toISOString();
  await args.doc.send(
    new PutCommand({
      TableName: args.tables.Pages,
      Item: next,
    }),
  );
  return next;
}

/** 삭제된 데이터베이스 목록(휴지통) — Pages 와 동일한 byWorkspaceAndDeletedAt GSI + 30일 보관 모델 */
export async function listTrashedDatabases(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  workspaceId: string;
  limit?: number;
  nextToken?: string | null;
}): Promise<Connection<Record<string, unknown>>> {
  if (!args.tables.Databases) badRequest("Databases table 미설정");
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "view",
  });
  const cutoffIso = new Date(Date.now() - TRASH_RETENTION_MS).toISOString();
  const pageSize = Math.min(Math.max(args.limit ?? TRASH_PAGE_MAX, 1), TRASH_PAGE_MAX);
  const parsed = decodeTrashCursor(args.nextToken ?? undefined);
  const collected: Record<string, unknown>[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined = parsed?.ek;
  let itemSkip = parsed?.skip ?? 0;

  let iterations = 0;
  while (collected.length < pageSize && iterations < 100) {
    iterations += 1;
    const queryStartKey = exclusiveStartKey;
    const r = await args.doc.send(
      new QueryCommand({
        TableName: args.tables.Databases,
        IndexName: "byWorkspaceAndDeletedAt",
        KeyConditionExpression: "workspaceId = :w AND deletedAt > :cutoff",
        ExpressionAttributeValues: { ":w": args.workspaceId, ":cutoff": cutoffIso },
        Limit: 100,
        ScanIndexForward: false,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    const batch = (r.Items ?? []) as Record<string, unknown>[];
    let i = itemSkip;
    itemSkip = 0;
    for (; i < batch.length && collected.length < pageSize; i++) {
      collected.push(batch[i]!);
    }
    if (collected.length >= pageSize) {
      collected.sort((a, b) =>
        String(b["deletedAt"] ?? "").localeCompare(String(a["deletedAt"] ?? "")),
      );
      let nextTok: string | null = null;
      if (i < batch.length) {
        nextTok = encodeTrashCursor({ ek: queryStartKey, skip: i });
      } else if (r.LastEvaluatedKey) {
        nextTok = encodeTrashCursor({ ek: r.LastEvaluatedKey as Record<string, unknown>, skip: 0 });
      }
      return { items: collected, nextToken: nextTok };
    }
    if (!r.LastEvaluatedKey) {
      collected.sort((a, b) =>
        String(b["deletedAt"] ?? "").localeCompare(String(a["deletedAt"] ?? "")),
      );
      return { items: collected, nextToken: null };
    }
    exclusiveStartKey = r.LastEvaluatedKey as Record<string, unknown>;
  }
  collected.sort((a, b) =>
    String(b["deletedAt"] ?? "").localeCompare(String(a["deletedAt"] ?? "")),
  );
  return { items: collected, nextToken: null };
}

/** 삭제된 데이터베이스 복원 — deletedAt 제거(restorePage 와 동일 모델). row 페이지는 삭제되지 않으므로 그대로 복귀. */
export async function restoreDatabase(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  id: string;
  workspaceId: string;
}): Promise<Record<string, unknown>> {
  if (!args.tables.Databases) badRequest("Databases table 미설정");
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "edit",
  });
  const existing = await args.doc.send(
    new GetCommand({ TableName: args.tables.Databases, Key: { id: args.id } }),
  );
  const item = existing.Item as Record<string, unknown> | undefined;
  if (!item) notFound("데이터베이스 없음");
  if (String(item["workspaceId"]) !== args.workspaceId) {
    badRequest("워크스페이스가 일치하지 않습니다");
  }
  if (item["deletedAt"] == null || item["deletedAt"] === "") {
    badRequest("삭제되지 않은 데이터베이스입니다");
  }
  const deletedMs = Date.parse(String(item["deletedAt"]));
  if (Number.isNaN(deletedMs)) badRequest("삭제 일시가 올바르지 않습니다");
  if (deletedMs < Date.now() - TRASH_RETENTION_MS) {
    badRequest("보관 기간이 지나 복원할 수 없습니다");
  }
  const next: Record<string, unknown> = { ...item };
  delete next["deletedAt"];
  next["updatedAt"] = new Date().toISOString();
  await args.doc.send(
    new PutCommand({ TableName: args.tables.Databases, Item: next }),
  );
  try {
    await recordDatabaseHistory({
      doc: args.doc,
      tables: args.tables,
      caller: args.caller,
      before: item,
      after: next,
      kind: "database.update",
    });
  } catch (err) {
    console.error("[restoreDatabase] DatabaseHistory 기록 실패 (무시)", err);
  }
  return next;
}

export async function listPageHistory(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  pageId: string;
  workspaceId: string;
  limit?: number;
}): Promise<Array<Record<string, unknown>>> {
  if (!args.tables.PageHistory) badRequest("PageHistory table 미설정");
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "view",
  });
  const limit = Math.min(Math.max(args.limit ?? 100, 1), 200);
  const res = await args.doc.send(
    new QueryCommand({
      TableName: args.tables.PageHistory,
      KeyConditionExpression: "pageId = :p",
      ExpressionAttributeValues: { ":p": args.pageId },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );
  return ((res.Items ?? []) as Array<Record<string, unknown>>).filter(
    (item) => item.workspaceId === args.workspaceId,
  );
}

/**
 * DB 소속 모든 row 페이지의 page-history 를 byDatabaseAndCreatedAt GSI 단일 쿼리로 모은다.
 * N+1(행마다 listPageHistory) 을 제거하고, 삭제된 행의 히스토리까지 포함한다.
 */
export async function listDatabaseRowHistory(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  databaseId: string;
  workspaceId: string;
  limit?: number;
  nextToken?: string;
}): Promise<Connection<Record<string, unknown>>> {
  if (!args.tables.PageHistory) badRequest("PageHistory table 미설정");
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "view",
  });
  const limit = Math.min(Math.max(args.limit ?? 100, 1), 200);
  const r = await args.doc.send(
    new QueryCommand({
      TableName: args.tables.PageHistory,
      IndexName: "byDatabaseAndCreatedAt",
      KeyConditionExpression: "databaseId = :d",
      ExpressionAttributeValues: { ":d": args.databaseId },
      ScanIndexForward: false,
      Limit: limit,
      ExclusiveStartKey: args.nextToken ? JSON.parse(args.nextToken) : undefined,
    }),
  );
  const items = ((r.Items ?? []) as Array<Record<string, unknown>>).filter(
    (item) => item.workspaceId === args.workspaceId,
  );
  return {
    items,
    nextToken: r.LastEvaluatedKey ? JSON.stringify(r.LastEvaluatedKey) : null,
  };
}

export async function restorePageVersion(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  input: { pageId: string; workspaceId: string; historyId: string };
}): Promise<Record<string, unknown>> {
  if (!args.tables.Pages) badRequest("Pages table 미설정");
  if (!args.tables.PageHistory) badRequest("PageHistory table 미설정");
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.input.workspaceId,
    required: "edit",
  });
  const history = await listPageHistoryAsc({
    doc: args.doc,
    tableName: args.tables.PageHistory,
    pageId: args.input.pageId,
  });
  let snapshot: Record<string, unknown> | null = null;
  let found = false;
  for (const event of history) {
    if (event.workspaceId !== args.input.workspaceId) continue;
    if (event.anchor && typeof event.anchor === "object") {
      snapshot = cloneJson(event.anchor as Record<string, unknown>);
    }
    const patch = event.patch;
    if (!Array.isArray(patch)) continue;
    snapshot = applyPagePatch(snapshot, patch as PagePatchOp[]);
    if (event.historyId === args.input.historyId) {
      found = true;
      break;
    }
  }
  if (!found || !snapshot) notFound("페이지 히스토리 없음");
  const existing = await args.doc.send(
    new GetCommand({ TableName: args.tables.Pages, Key: { id: args.input.pageId } }),
  );
  const before = (existing.Item as Record<string, unknown> | undefined) ?? null;
  const now = new Date().toISOString();
  const restored: Record<string, unknown> = {
    ...snapshot,
    id: args.input.pageId,
    workspaceId: args.input.workspaceId,
    updatedAt: now,
  };
  delete restored["deletedAt"];
  await args.doc.send(
    new PutCommand({
      TableName: args.tables.Pages,
      Item: restored,
      ConditionExpression: "attribute_not_exists(workspaceId) OR workspaceId = :w",
      ExpressionAttributeValues: { ":w": args.input.workspaceId },
    }),
  );
  try {
    await recordPageHistory({
      doc: args.doc,
      tables: args.tables,
      caller: args.caller,
      before,
      after: restored,
      kind: "page.restoreVersion",
    });
  } catch (err) {
    console.error("[restorePageVersion] PageHistory 기록 실패 (무시)", err);
  }
  return restored;
}

export async function deletePageHistoryEvents(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  pageId: string;
  workspaceId: string;
  historyIds: string[];
}): Promise<boolean> {
  if (!args.tables.PageHistory) badRequest("PageHistory table 미설정");
  if (!Array.isArray(args.historyIds) || args.historyIds.length === 0) return true;
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "edit",
  });
  for (let i = 0; i < args.historyIds.length; i += 25) {
    const chunk = args.historyIds.slice(i, i + 25);
    await args.doc.send(
      new BatchWriteCommand({
        RequestItems: {
          [args.tables.PageHistory]: chunk.map((historyId) => ({
            DeleteRequest: { Key: { pageId: args.pageId, historyId } },
          })),
        },
      }),
    );
  }
  return true;
}

export async function listDatabaseHistory(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  databaseId: string;
  workspaceId: string;
  limit?: number;
}): Promise<Array<Record<string, unknown>>> {
  if (!args.tables.DatabaseHistory) badRequest("DatabaseHistory table 미설정");
  requireDatabaseHistoryOwnerKey(args.caller);
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "view",
  });
  const limit = Math.min(Math.max(args.limit ?? 100, 1), 200);
  const res = await args.doc.send(
    new QueryCommand({
      TableName: args.tables.DatabaseHistory,
      KeyConditionExpression: "databaseId = :d",
      ExpressionAttributeValues: { ":d": args.databaseId },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );
  return ((res.Items ?? []) as Array<Record<string, unknown>>).filter(
    (item) => item.workspaceId === args.workspaceId,
  );
}

export async function restoreDatabaseVersion(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  input: { databaseId: string; workspaceId: string; historyId: string };
}): Promise<Record<string, unknown>> {
  if (!args.tables.Databases) badRequest("Databases table 미설정");
  if (!args.tables.DatabaseHistory) badRequest("DatabaseHistory table 미설정");
  requireDatabaseHistoryOwnerKey(args.caller);
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.input.workspaceId,
    required: "edit",
  });
  const history = await listDatabaseHistoryAsc({
    doc: args.doc,
    tableName: args.tables.DatabaseHistory,
    databaseId: args.input.databaseId,
  });
  let snapshot: Record<string, unknown> | null = null;
  let found = false;
  for (const event of history) {
    if (event.workspaceId !== args.input.workspaceId) continue;
    if (event.anchor && typeof event.anchor === "object") {
      snapshot = cloneJson(event.anchor as Record<string, unknown>);
    }
    const patch = event.patch;
    if (!Array.isArray(patch)) continue;
    snapshot = applyDatabasePatch(snapshot, patch as PagePatchOp[]);
    if (event.historyId === args.input.historyId) {
      found = true;
      break;
    }
  }
  if (!found || !snapshot) notFound("DB 히스토리 없음");
  const existing = await args.doc.send(
    new GetCommand({ TableName: args.tables.Databases, Key: { id: args.input.databaseId } }),
  );
  const before = (existing.Item as Record<string, unknown> | undefined) ?? null;
  const now = new Date().toISOString();
  const restored: Record<string, unknown> = {
    ...snapshot,
    id: args.input.databaseId,
    workspaceId: args.input.workspaceId,
    updatedAt: now,
  };
  delete restored["deletedAt"];
  await args.doc.send(
    new PutCommand({
      TableName: args.tables.Databases,
      Item: restored,
      ConditionExpression: "attribute_not_exists(workspaceId) OR workspaceId = :w",
      ExpressionAttributeValues: { ":w": args.input.workspaceId },
    }),
  );
  try {
    await recordDatabaseHistory({
      doc: args.doc,
      tables: args.tables,
      caller: args.caller,
      before,
      after: restored,
      kind: "database.restoreVersion",
    });
  } catch (err) {
    console.error("[restoreDatabaseVersion] DatabaseHistory 기록 실패 (무시)", err);
  }
  return restored;
}

export async function deleteDatabaseHistoryEvents(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  databaseId: string;
  workspaceId: string;
  historyIds: string[];
}): Promise<boolean> {
  if (!args.tables.DatabaseHistory) badRequest("DatabaseHistory table 미설정");
  requireDatabaseHistoryOwnerKey(args.caller);
  if (!Array.isArray(args.historyIds) || args.historyIds.length === 0) return true;
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "edit",
  });
  for (let i = 0; i < args.historyIds.length; i += 25) {
    const chunk = args.historyIds.slice(i, i + 25);
    await args.doc.send(
      new BatchWriteCommand({
        RequestItems: {
          [args.tables.DatabaseHistory]: chunk.map((historyId) => ({
            DeleteRequest: { Key: { databaseId: args.databaseId, historyId } },
          })),
        },
      }),
    );
  }
  return true;
}

export async function validateWorkspaceSubscription(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  workspaceId: string;
}): Promise<null> {
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "view",
  });
  return null;
}
