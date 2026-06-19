import { Buffer } from "node:buffer";
import {
  BatchGetCommand,
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
const PAGE_META_INTERNAL_QUERY_MAX = 50;

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
import {
  removeLCDatabaseRowMemberIndexForPage,
  syncLCDatabaseRowMemberIndexForPage,
} from "./lcDatabaseRowMemberIndex";
import { reconcileTemplateAutomationSchedules } from "./templateAutomationScheduler";
import {
  SESSION_PATCH_COMPACT_LIMIT,
  canMergeIntoSession,
  compactPatchOps,
  diffMeaningfulDatabaseUnits,
  diffMeaningfulPageUnits,
  mergeContributors,
} from "./historySession";

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
  "titleColor",
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
  "templates",
  // 행 멤버십 순서. Database 테이블 레코드에는 저장하지 않고(업서트 전 strip),
  // 히스토리 스냅샷에만 포함시켜 행 추가/삭제를 DB 버전으로 기록한다.
  "rowPageOrder",
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

function parseJsonLike(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isEmptyParagraphNode(node: unknown): boolean {
  if (!isPlainObject(node)) return false;
  if (node.type !== "paragraph") return false;
  const content = node.content;
  return !Array.isArray(content) || content.length === 0;
}

export function isPlaceholderPageDoc(value: unknown): boolean {
  const doc = parseJsonLike(value);
  if (!isPlainObject(doc) || doc.type !== "doc") return false;
  const content = doc.content;
  if (!Array.isArray(content)) return true;
  if (content.length === 0) return true;
  return content.every(isEmptyParagraphNode);
}

function hasMeaningfulPageDocNode(node: unknown): boolean {
  if (!isPlainObject(node)) return false;
  if (node.type === "text") {
    return typeof node.text === "string" && node.text.length > 0;
  }
  if (node.type !== "paragraph") return true;
  const content = node.content;
  return Array.isArray(content) && content.some(hasMeaningfulPageDocNode);
}

export function hasMeaningfulPageDocContent(value: unknown): boolean {
  const doc = parseJsonLike(value);
  if (!isPlainObject(doc) || doc.type !== "doc") return false;
  const content = doc.content;
  return Array.isArray(content) && content.some(hasMeaningfulPageDocNode);
}

// 들어온 upsert input 의 doc 이 "본문을 가지지 않은" 상태인지 판정한다.
// 빈 placeholder(빈 문단만) 뿐 아니라 **키 부재 / null / undefined / 빈 문자열**까지 포함한다.
// upsertRecord 는 전체 PutItem(전치환)이므로, 메타데이터만 보내는(doc 키 누락) 업서트나
// JSON.stringify(undefined)===undefined 로 doc 이 떨어져 나간 업서트가 그대로 저장되면
// 서버 본문이 통째로 소거된다(라이브 데이터 오염의 근본 경로). 이 판정으로 그 입력들을
// 전부 "본문 없음" 으로 묶어 기존 본문 보존 대상에 포함시킨다.
export function incomingDocLacksContent(input: Record<string, unknown>): boolean {
  if (!("doc" in input)) return true;
  const value = input.doc;
  if (value == null) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  return isPlaceholderPageDoc(value);
}

function isOnlyUpdatedAtPageChange(
  input: Record<string, unknown>,
  existingPage: Record<string, unknown>,
): boolean {
  const incomingSnap = normalizePageSnapshot(input);
  const existingSnap = normalizePageSnapshot(existingPage);
  for (const key of PAGE_HISTORY_FIELDS) {
    if (key === "updatedAt") continue;
    const incomingHas = key in incomingSnap;
    const existingHas = key in existingSnap;
    if (!incomingHas && !existingHas) continue;
    if (incomingHas !== existingHas) return false;
    if (!jsonEqual(incomingSnap[key], existingSnap[key])) return false;
  }
  return true;
}

export function preserveExistingDocForPlaceholderInput(
  input: Record<string, unknown>,
  existingPage: Record<string, unknown> | null,
): void {
  if (!existingPage) return;
  // 들어온 doc 이 본문을 갖지 않고(키 부재/null/빈/placeholder), 기존 본문은 유의미하면
  // 절대 덮어쓰지 않는다 — 클라이언트 버전·버그와 무관한 서버 최후 방어선.
  if (!incomingDocLacksContent(input)) return;
  if (!hasMeaningfulPageDocContent(existingPage.doc)) return;

  input.doc = existingPage.doc;
  // 메타 baseline/본문 지연 로드 중 빈 placeholder만 재전송된 경우에는
  // updatedAt 차이만으로 "페이지 수정" 히스토리가 생기지 않도록 기존 시각을 유지한다.
  if (isOnlyUpdatedAtPageChange(input, existingPage)) {
    input.updatedAt = existingPage.updatedAt;
  }
}

// 의미있는 dbCells(객체이고 키가 1개 이상)인지 — 빈 {}/null/비객체는 "내용 없음".
export function hasMeaningfulDbCells(value: unknown): boolean {
  const parsed = parseJsonLike(value);
  return isPlainObject(parsed) && Object.keys(parsed).length > 0;
}

// 서버 최후 방어선(dbCells) — doc 백스톤과 동형.
// 협업 ON DB 행 페이지는 셀 권위가 DB Y룸이라, 클라가 비-셀 업서트(본문 편집·주기 업서트)에서
// dbCells 를 null 로 비워 보낸다(helpers.ts). 서버가 그걸 그대로 저장하면 page.dbCells 가 상시
// null 로 비워져 ① 셀의 durable 영속처가 사라지고(Y룸 유실 시 복구 불가) ② 히스토리 스냅샷에
// 셀이 안 잡힌다. 들어온 dbCells 가 "건드리지 마"(키 부재/null)면 기존 셀을 보존한다.
// 권위적 셀 상태(객체 — 빈 {} 로 "모두 비움" 포함)는 그대로 적용해 셀 편집·비우기는 정상 동작한다.
export function preserveExistingDbCellsForNullInput(
  input: Record<string, unknown>,
  existingPage: Record<string, unknown> | null,
): void {
  if (!existingPage) return;
  // 권위적 셀(객체, 빈 {} 포함) 입력은 그대로 둔다.
  if ("dbCells" in input && input.dbCells != null) return;
  // 키 부재/null = "건드리지 마" → 기존 셀이 의미있으면 보존.
  if (hasMeaningfulDbCells(existingPage.dbCells)) {
    input.dbCells = existingPage.dbCells;
  }
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

/** 히스토리 최신 엔트리 1건 조회 (세션 머지 판정용 — 전량 스캔 금지). */
async function latestHistoryEntry(args: {
  doc: DynamoDBDocumentClient;
  tableName: string;
  keyName: "pageId" | "databaseId";
  keyValue: string;
}): Promise<Record<string, unknown> | null> {
  const res = await args.doc.send(
    new QueryCommand({
      TableName: args.tableName,
      KeyConditionExpression: "#k = :v",
      ExpressionAttributeNames: { "#k": args.keyName },
      ExpressionAttributeValues: { ":v": args.keyValue },
      ScanIndexForward: false,
      Limit: 1,
    }),
  );
  return ((res.Items ?? [])[0] as Record<string, unknown> | undefined) ?? null;
}

/**
 * 세션 머지 버전 기록(페이지).
 * - 일반 편집(page.update)은 의미 변화(diffMeaningfulPageUnits)가 없으면 기록하지 않는다
 *   (빈 블럭 생성/삭제, 블럭 밀림(order), blockComments 읽음 시각 등은 버전 사유가 아님).
 * - 직전 엔트리가 열린 세션(idle 15분·최대 60분 내)이면 새 엔트리 대신 그 엔트리를 갱신한다.
 *   동시 머지 race 는 LWW 로 수용한다(본문은 CRDT/서버 권위로 수렴, 손실은 귀속 메타뿐).
 * - patch 는 직전 엔트리 post-state(snapshot) 기준 누적 합성 — 레거시 patch 체인 워커와 호환.
 */
async function recordPageHistory(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  kind: string;
  /** true 면 의미 변화가 없어도 항상 새 버전 엔트리를 기록한다(수동 "버전 저장" 체크포인트용). */
  force?: boolean;
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
  const latest = await latestHistoryEntry({
    doc: args.doc,
    tableName,
    keyName: "pageId",
    keyValue: pageId,
  });
  const afterSnap = normalizePageSnapshot(args.after);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const caller = { memberId: args.caller.memberId, name: args.caller.name };
  if (!latest) {
    // 히스토리가 0건인 페이지는 변경 유무와 무관하게 최초 1건을 베이스라인으로 기록한다.
    // (기능 도입 이전에 생성됐거나, 첫 upsert 가 기록 경로를 못 탔던 페이지의 버전 보정.)
    await args.doc.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          pageId,
          historyId: `${nowIso}#${uuid()}`,
          workspaceId,
          ...(rowDatabaseId ? { databaseId: rowDatabaseId } : {}),
          kind: "page.create",
          patch: [{ op: "set", path: [], value: afterSnap }],
          anchor: afterSnap,
          snapshot: afterSnap,
          sessionStartedAt: nowIso,
          lastActivityAt: nowIso,
          contributors: mergeContributors(null, caller),
          createdAt: nowIso,
          createdByMemberId: args.caller.memberId,
          createdByName: args.caller.name,
        },
      }),
    );
    return;
  }
  const beforeSnap = args.before ? normalizePageSnapshot(args.before) : null;
  const changedUnits = diffMeaningfulPageUnits(beforeSnap, afterSnap);
  if (args.kind === "page.update" && changedUnits.length === 0) return;
  // 직전 엔트리 post-state. 레거시 엔트리(snapshot 없음)는 upsert 시점 before 로 근사한다
  // (의미 무시 필드(order 등)만 스킵돼 미세 드리프트 가능 — 무해).
  const latestSnapshot = isPlainObject(parseJsonLike(latest.snapshot))
    ? (parseJsonLike(latest.snapshot) as Record<string, unknown>)
    : null;
  const patchBase = latestSnapshot ?? beforeSnap;
  if (
    args.kind === "page.update" &&
    canMergeIntoSession({ latest, sessionKind: "page.session", workspaceId, now: nowMs })
  ) {
    const priorOps = Array.isArray(latest.patch) ? (latest.patch as PagePatchOp[]) : [];
    let patch = compactPatchOps([...priorOps, ...diffPageSnapshot(patchBase, afterSnap)]);
    if (patch.length > SESSION_PATCH_COMPACT_LIMIT) {
      patch = [{ op: "set", path: [], value: afterSnap }];
    }
    const priorUnits = Array.isArray(latest.changedUnits)
      ? (latest.changedUnits as string[])
      : [];
    await args.doc.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          ...latest,
          patch,
          snapshot: afterSnap,
          changedUnits: [...new Set([...priorUnits, ...changedUnits])].sort(),
          lastActivityAt: nowIso,
          contributors: mergeContributors(latest.contributors, caller),
          // 세션 최종 편집자(= Yjs lastEditedBy 와 동일 소스인 upsert caller)로 갱신
          createdByMemberId: args.caller.memberId,
          createdByName: args.caller.name,
        },
      }),
    );
    return;
  }
  const patch = diffPageSnapshot(patchBase, afterSnap);
  if (!args.force && patch.length === 0 && changedUnits.length === 0) return;
  const kind = args.kind === "page.update" ? "page.session" : args.kind;
  await args.doc.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        pageId,
        historyId: `${nowIso}#${uuid()}`,
        workspaceId,
        ...(rowDatabaseId ? { databaseId: rowDatabaseId } : {}),
        kind,
        patch,
        snapshot: afterSnap,
        ...(changedUnits.length > 0 ? { changedUnits } : {}),
        sessionStartedAt: nowIso,
        lastActivityAt: nowIso,
        contributors: mergeContributors(null, caller),
        createdAt: nowIso,
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

/** 세션 머지 버전 기록(DB 구조) — 페이지와 동일 규칙. panelState 등 UI 휘발 상태는 버전 사유가 아니다. */
async function recordDatabaseHistory(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  kind: string;
  /** true 면 의미 변화가 없어도 항상 새 버전 엔트리를 기록한다(수동 "버전 저장" 체크포인트용). */
  force?: boolean;
}): Promise<void> {
  const tableName = args.tables.DatabaseHistory;
  if (!tableName) return;
  const ownerId = requireDatabaseHistoryOwnerKey(args.caller);
  const databaseId = typeof args.after.id === "string" ? args.after.id : null;
  const workspaceId = typeof args.after.workspaceId === "string" ? args.after.workspaceId : null;
  if (!databaseId || !workspaceId) return;
  const latest = await latestHistoryEntry({
    doc: args.doc,
    tableName,
    keyName: "databaseId",
    keyValue: databaseId,
  });
  const afterSnap = normalizeDatabaseSnapshot(args.after);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const caller = { memberId: args.caller.memberId, name: args.caller.name };
  if (!latest) {
    await args.doc.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          databaseId,
          historyId: `${nowIso}#${uuid()}`,
          workspaceId,
          ownerId,
          kind: "database.create",
          patch: [{ op: "set", path: [], value: afterSnap }],
          anchor: afterSnap,
          snapshot: afterSnap,
          sessionStartedAt: nowIso,
          lastActivityAt: nowIso,
          contributors: mergeContributors(null, caller),
          createdAt: nowIso,
          createdByMemberId: args.caller.memberId,
          createdByName: args.caller.name,
        },
      }),
    );
    return;
  }
  const beforeSnap = args.before ? normalizeDatabaseSnapshot(args.before) : null;
  const latestSnapshot = isPlainObject(parseJsonLike(latest.snapshot))
    ? (parseJsonLike(latest.snapshot) as Record<string, unknown>)
    : null;
  // changedUnits 는 직전 버전(히스토리 스냅샷) 기준으로 계산한다. Database 레코드(beforeSnap)에는
  // rowPageOrder 가 저장되지 않아, 레코드 기준이면 매 upsert 마다 "rows" 가 항상 변경으로 잡혀
  // 불필요한 버전이 생긴다. 직전 스냅샷에는 rowPageOrder 가 있어 실제 행 변경만 잡힌다.
  const changedUnits = diffMeaningfulDatabaseUnits(latestSnapshot ?? beforeSnap, afterSnap);
  if (!args.force && args.kind === "database.update" && changedUnits.length === 0) return;
  const patchBase = latestSnapshot ?? beforeSnap;
  // 행 멤버십(rows) 변경은 세션 머지하지 않고 독립 버전으로 남긴다. 머지하면 행 삭제가 같은
  // 세션 스냅샷을 덮어써 삭제 전 상태가 사라져 복구가 불가능해진다(req: 실수 삭제 복구).
  // 연속 추가는 materialize 디바운스가 한 upsert 로 묶고, 동일 재전송은 위 changedUnits 빈값
  // 가드로 스킵되므로 버전 스팸은 없다.
  const isRowMembershipChange = changedUnits.includes("rows");
  if (
    args.kind === "database.update" &&
    !isRowMembershipChange &&
    canMergeIntoSession({ latest, sessionKind: "database.session", workspaceId, now: nowMs })
  ) {
    const priorOps = Array.isArray(latest.patch) ? (latest.patch as PagePatchOp[]) : [];
    let patch = compactPatchOps([...priorOps, ...diffDatabaseSnapshot(patchBase, afterSnap)]);
    if (patch.length > SESSION_PATCH_COMPACT_LIMIT) {
      patch = [{ op: "set", path: [], value: afterSnap }];
    }
    const priorUnits = Array.isArray(latest.changedUnits)
      ? (latest.changedUnits as string[])
      : [];
    await args.doc.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          ...latest,
          patch,
          snapshot: afterSnap,
          changedUnits: [...new Set([...priorUnits, ...changedUnits])].sort(),
          lastActivityAt: nowIso,
          contributors: mergeContributors(latest.contributors, caller),
          createdByMemberId: args.caller.memberId,
          createdByName: args.caller.name,
        },
      }),
    );
    return;
  }
  const patch = diffDatabaseSnapshot(patchBase, afterSnap);
  if (!args.force && patch.length === 0 && changedUnits.length === 0) return;
  const kind = args.kind === "database.update" ? "database.session" : args.kind;
  await args.doc.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        databaseId,
        historyId: `${nowIso}#${uuid()}`,
        workspaceId,
        ownerId,
        kind,
        patch,
        snapshot: afterSnap,
        ...(changedUnits.length > 0 ? { changedUnits } : {}),
        sessionStartedAt: nowIso,
        lastActivityAt: nowIso,
        contributors: mergeContributors(null, caller),
        createdAt: nowIso,
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

export async function listPageMetas(args: {
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
  const expressionValues: Record<string, unknown> = {
    ":w": args.workspaceId,
  };
  let keyCondition = "workspaceId = :w";
  if (args.updatedAfter) {
    keyCondition += " AND updatedAt > :u";
    expressionValues[":u"] = args.updatedAfter;
  }
  const limit = Math.max(1, args.limit ?? 100);
  const items: Record<string, unknown>[] = [];
  let exclusiveStartKey = args.nextToken ? JSON.parse(args.nextToken) as Record<string, unknown> : undefined;
  let queryCount = 0;
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const r = await args.doc.send(
      new QueryCommand({
        TableName: args.tables.Pages,
        IndexName: "byWorkspaceAndUpdatedAt",
        KeyConditionExpression: keyCondition,
        ProjectionExpression: "id, workspaceId, createdByMemberId, title, titleColor, icon, coverImage, parentId, #order, databaseId, createdAt, updatedAt, deletedAt, fullPageDatabaseId, lastEditedByMemberId, lastEditedByName",
        ExpressionAttributeNames: { "#order": "order" },
        ExpressionAttributeValues: expressionValues,
        Limit: limit - items.length,
        ExclusiveStartKey: exclusiveStartKey,
        ScanIndexForward: false,
      }),
    );
    for (const item of r.Items ?? []) {
      const databaseId = item.databaseId;
      if (databaseId == null || databaseId === "") items.push(item as Record<string, unknown>);
    }
    lastEvaluatedKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
    exclusiveStartKey = lastEvaluatedKey;
    queryCount += 1;
  } while (
    items.length < limit &&
    exclusiveStartKey &&
    queryCount < PAGE_META_INTERNAL_QUERY_MAX
  );

  return {
    items,
    nextToken: lastEvaluatedKey ? JSON.stringify(lastEvaluatedKey) : null,
  };
}

export async function getPage(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  id: string;
  workspaceId: string;
}): Promise<Record<string, unknown> | null> {
  if (!args.tables.Pages) badRequest("Pages table 미설정");
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "view",
  });
  const r = await args.doc.send(
    new GetCommand({ TableName: args.tables.Pages, Key: { id: args.id } }),
  );
  const item = r.Item as Record<string, unknown> | undefined;
  if (!item) return null;
  if (String(item["workspaceId"]) !== args.workspaceId) return null;
  return item;
}

/** dbCells(문자열/객체)에서 단일 scope 셀 값을 읽어 ${databaseId}#${id} 형식으로 비교 가능하게 한다. */
function pageScopeValue(
  page: Record<string, unknown>,
  columnId: string,
): string | null {
  let cells: Record<string, unknown> | null = null;
  const raw = page.dbCells;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      cells = isPlainObject(parsed) ? parsed : null;
    } catch {
      cells = null;
    }
  } else if (isPlainObject(raw)) {
    cells = raw;
  }
  if (!cells) return null;
  return readScopeCellValue(cells, columnId);
}

/**
 * assigneeId 지정 시: 작업 DB 구성원 색인(DatabaseRowMembers) 으로 pageId 를 좁힌 뒤
 * Pages BatchGet(100개 청크) 으로 실제 row 를 가져온다. org/team/project 동시 지정 시 post-filter.
 * nextToken 은 member 인덱스 Query 의 LastEvaluatedKey 를 사용한다.
 */
async function listDatabaseRowsByAssignee(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  databaseId: string;
  workspaceId: string;
  assigneeId: string;
  organizationId?: string;
  teamId?: string;
  projectId?: string;
  limit: number;
}): Promise<Connection<Record<string, unknown>>> {
  const memberTable = args.tables.DatabaseRowMembers;
  // 색인 테이블 미설정이면 빈 결과(회귀 없이 graceful) — scope 미지정 경로는 별도 처리됨.
  if (!memberTable || !args.tables.Pages) return { items: [], nextToken: null };

  const indexRes = await args.doc.send(
    new QueryCommand({
      TableName: memberTable,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": `${args.databaseId}#${args.assigneeId}` },
      Limit: args.limit,
    }),
  );
  const indexItems = (indexRes.Items ?? []) as Array<Record<string, unknown>>;
  const pageIds = Array.from(
    new Set(
      indexItems
        .map((item) => item.pageId)
        .filter((id): id is string => typeof id === "string"),
    ),
  );
  if (!pageIds.length) {
    return {
      items: [],
      nextToken: indexRes.LastEvaluatedKey ? JSON.stringify(indexRes.LastEvaluatedKey) : null,
    };
  }

  // Pages BatchGet — 100개 청크.
  const fetched: Array<Record<string, unknown>> = [];
  for (let i = 0; i < pageIds.length; i += 100) {
    const chunk = pageIds.slice(i, i + 100);
    const res = await args.doc.send(
      new BatchGetCommand({
        RequestItems: {
          [args.tables.Pages]: { Keys: chunk.map((id) => ({ id })) },
        },
      }),
    );
    const got = (res.Responses?.[args.tables.Pages] ?? []) as Array<Record<string, unknown>>;
    fetched.push(...got);
  }

  const scopeColumns = resolveProtectedDbScopeColumnIds(args.databaseId);
  const filtered = fetched.filter((page) => {
    if (page.workspaceId !== args.workspaceId) return false;
    // 미삭제만.
    const deletedAt = page.deletedAt;
    if (typeof deletedAt === "string" && deletedAt !== "") return false;
    // org/team/project 동시 지정 시 dbCells scope 일치 post-filter (우선순위 project>team>org).
    if (scopeColumns) {
      if (args.projectId) {
        return pageScopeValue(page, scopeColumns.project) === args.projectId;
      }
      if (args.teamId) {
        return pageScopeValue(page, scopeColumns.team) === args.teamId;
      }
      if (args.organizationId) {
        return pageScopeValue(page, scopeColumns.organization) === args.organizationId;
      }
    }
    return true;
  });

  // order(문자열 숫자) 기준 정렬 — 안정적 표시 순서.
  filtered.sort((a, b) => {
    const ao = Number(a.order);
    const bo = Number(b.order);
    if (Number.isFinite(ao) && Number.isFinite(bo) && ao !== bo) return ao - bo;
    return String(a.order ?? "").localeCompare(String(b.order ?? ""));
  });

  return {
    items: filtered,
    nextToken: indexRes.LastEvaluatedKey ? JSON.stringify(indexRes.LastEvaluatedKey) : null,
  };
}

export async function listDatabaseRows(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  databaseId: string;
  workspaceId: string;
  organizationId?: string;
  teamId?: string;
  projectId?: string;
  assigneeId?: string;
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
  const limit = Math.min(Math.max(args.limit ?? 100, 1), 200);

  // 우선순위: assigneeId(구성원 색인) > project/team/org(scope GSI) > 기존 byDatabaseAndOrder.
  if (args.assigneeId) {
    return listDatabaseRowsByAssignee({
      doc: args.doc,
      tables: args.tables,
      databaseId: args.databaseId,
      workspaceId: args.workspaceId,
      assigneeId: args.assigneeId,
      organizationId: args.organizationId,
      teamId: args.teamId,
      projectId: args.projectId,
      limit,
    });
  }

  // scope 우선순위: project > team > organization (먼저 지정된 것 하나만 적용).
  // scope 지정 시 해당 비정규화 GSI(dbScope*) 로 ${databaseId}#${scopeId} 키만 조회해 비용 절감.
  let indexName = "byDatabaseAndOrder";
  let keyCondition = "databaseId = :d";
  let keyValue = args.databaseId;
  if (args.projectId) {
    indexName = "byDbScopeProject";
    keyCondition = "dbScopeProject = :d";
    keyValue = `${args.databaseId}#${args.projectId}`;
  } else if (args.teamId) {
    indexName = "byDbScopeTeam";
    keyCondition = "dbScopeTeam = :d";
    keyValue = `${args.databaseId}#${args.teamId}`;
  } else if (args.organizationId) {
    indexName = "byDbScopeOrg";
    keyCondition = "dbScopeOrg = :d";
    keyValue = `${args.databaseId}#${args.organizationId}`;
  }

  const r = await args.doc.send(
    new QueryCommand({
      TableName: args.tables.Pages,
      IndexName: indexName,
      KeyConditionExpression: keyCondition,
      FilterExpression: "workspaceId = :w AND (attribute_not_exists(deletedAt) OR attribute_type(deletedAt, :nullType) OR deletedAt = :empty)",
      ExpressionAttributeValues: {
        ":d": keyValue,
        ":w": args.workspaceId,
        ":empty": "",
        ":nullType": "NULL",
      },
      ScanIndexForward: true,
      Limit: limit,
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

export async function getDatabase(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  id: string;
  workspaceId: string;
}): Promise<Record<string, unknown> | null> {
  if (!args.tables.Databases) badRequest("Databases table 미설정");
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "view",
  });
  const r = await args.doc.send(
    new GetCommand({ TableName: args.tables.Databases, Key: { id: args.id } }),
  );
  const item = r.Item as Record<string, unknown> | undefined;
  if (!item) return null;
  if (String(item["workspaceId"]) !== args.workspaceId) return null;
  return item;
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

/**
 * LC 보호 DB(작업/마일스톤/피처) row 의 org/팀/프로젝트 scope 컬럼 ID 접두사.
 * databaseId 접두사로 어떤 보호 DB 인지 판별해 대응되는 컬럼 ID 셋을 반환한다.
 * - 작업(lc-scheduler-db:) → lc-scheduler:*
 * - 마일스톤(lc-milestone-db:) → lc-milestone:*
 * - 피처(lc-feature-db:) → lc-feature:*
 */
const LC_PROTECTED_DB_SCOPE_COLUMN_IDS: ReadonlyArray<{
  prefix: string;
  organization: string;
  team: string;
  project: string;
}> = [
  {
    prefix: "lc-scheduler-db:",
    organization: "lc-scheduler:organization",
    team: "lc-scheduler:team",
    project: "lc-scheduler:project",
  },
  {
    prefix: "lc-milestone-db:",
    organization: "lc-milestone:organization",
    team: "lc-milestone:team",
    project: "lc-milestone:project",
  },
  {
    prefix: "lc-feature-db:",
    organization: "lc-feature:organization",
    team: "lc-feature:team",
    project: "lc-feature:project",
  },
];

function resolveProtectedDbScopeColumnIds(
  databaseId: unknown,
): { organization: string; team: string; project: string } | null {
  if (typeof databaseId !== "string") return null;
  for (const entry of LC_PROTECTED_DB_SCOPE_COLUMN_IDS) {
    if (databaseId.startsWith(entry.prefix)) {
      return { organization: entry.organization, team: entry.team, project: entry.project };
    }
  }
  return null;
}

/** dbCells(문자열 또는 객체)에서 단일 scope 셀 값을 문자열로 읽는다. 없으면 null. */
function readScopeCellValue(cells: Record<string, unknown>, columnId: string): string | null {
  const raw = cells[columnId];
  if (raw == null) return null;
  // select 셀은 보통 문자열(옵션 id)이지만, 객체/배열 형태일 수도 있어 방어적으로 처리한다.
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  return null;
}

/**
 * 보호 DB row 의 비정규화 scope 키(dbScopeOrg/Team/Project)를 input 에 세팅한다.
 * 형식: `${databaseId}#${scopeId}`. 값이 없으면 속성을 넣지 않아 sparse GSI 에서 제외한다.
 * 비-보호 DB row 는 건드리지 않는다(scope 컬럼 셋이 없으면 즉시 반환).
 */
function deriveDatabaseRowScopeKeys(input: Record<string, unknown>): void {
  const databaseId = input.databaseId;
  const scopeColumns = resolveProtectedDbScopeColumnIds(databaseId);
  // 빈 문자열/null GSI 키 금지 — 항상 먼저 기존 scope 속성을 제거하고, 유효 값만 다시 세팅한다.
  delete input.dbScopeOrg;
  delete input.dbScopeTeam;
  delete input.dbScopeProject;
  if (!scopeColumns || typeof databaseId !== "string") return;

  // dbCells 는 AWSJSON — 문자열이면 파싱, 파싱 실패 시 scope 키 생략.
  let cells: Record<string, unknown> | null = null;
  const rawCells = input.dbCells;
  if (typeof rawCells === "string") {
    try {
      const parsed = JSON.parse(rawCells) as unknown;
      cells = isPlainObject(parsed) ? parsed : null;
    } catch {
      cells = null;
    }
  } else if (isPlainObject(rawCells)) {
    cells = rawCells;
  }
  if (!cells) return;

  const org = readScopeCellValue(cells, scopeColumns.organization);
  const team = readScopeCellValue(cells, scopeColumns.team);
  const project = readScopeCellValue(cells, scopeColumns.project);
  if (org != null) input.dbScopeOrg = `${databaseId}#${org}`;
  if (team != null) input.dbScopeTeam = `${databaseId}#${team}`;
  if (project != null) input.dbScopeProject = `${databaseId}#${project}`;
}

/**
 * order 를 byDatabaseAndOrder GSI sort key(STRING, non-null)에 적합하게 보정한다.
 * 유효한 숫자 문자열이면 그대로 두고, 아니면 createdAt→updatedAt epoch ms 문자열로 채운다.
 */
function normalizePageOrderField(input: Record<string, unknown>): void {
  const order = input.order;
  if (typeof order === "string" && order !== "" && !Number.isNaN(Number(order))) {
    return;
  }
  for (const key of ["createdAt", "updatedAt"]) {
    const v = input[key];
    if (typeof v === "string" && v) {
      const ms = Date.parse(v);
      if (!Number.isNaN(ms)) {
        input.order = String(ms);
        return;
      }
    }
    if (typeof v === "number" && Number.isFinite(v)) {
      input.order = String(v);
      return;
    }
  }
  input.order = "0";
}

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
  normalizeAwsJsonStringField(input, "templates", "templates");
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

function parseJsonArray(raw: unknown): unknown[] | null {
  if (raw == null || raw === "") return null;
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function templateIdOf(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const id = (value as Record<string, unknown>).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function mergeTemplateArrayById(existingRaw: unknown, incomingRaw: unknown): string | null {
  const incoming = parseJsonArray(incomingRaw);
  if (!incoming) return null;
  const existing = parseJsonArray(existingRaw) ?? [];
  const merged = [...existing];
  const indexById = new Map<string, number>();
  for (let index = 0; index < merged.length; index += 1) {
    const id = templateIdOf(merged[index]);
    if (id) indexById.set(id, index);
  }
  let changed = false;
  for (const template of incoming) {
    const id = templateIdOf(template);
    if (!id) continue;
    const existingIndex = indexById.get(id);
    if (existingIndex == null) {
      indexById.set(id, merged.length);
      merged.push(template);
      changed = true;
      continue;
    }
    if (!jsonEqual(merged[existingIndex], template)) {
      merged[existingIndex] = template;
      changed = true;
    }
  }
  return changed ? JSON.stringify(merged) : null;
}

function mergeStaleDatabaseTemplates(
  input: Record<string, unknown>,
  existingItem: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!("templates" in input)) return null;
  const templates = mergeTemplateArrayById(existingItem.templates, input.templates);
  if (!templates) return null;
  return {
    ...existingItem,
    templates,
  };
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
  // fullPageDatabaseId 도 동일하게 보존한다 — 키를 빼고 Put 하는 클라이언트(구 빌드,
  // 또는 태그가 로컬에 없는 stale 페이지의 재업서트)가 풀페이지 DB 홈 태그를 소거하면
  // 홈이 사이드바에 유령 페이지로 노출된다(wiki/pages/ghost-page-prevention.md).
  if (!("fullPageDatabaseId" in input) || input.fullPageDatabaseId == null) {
    const prev = existingPage?.fullPageDatabaseId;
    if (prev != null) {
      input.fullPageDatabaseId = prev;
    } else {
      delete input.fullPageDatabaseId;
    }
  }
  validateCoverImageField(input);
  normalizeBlockCommentsField(input);
  // byDatabaseAndOrder GSI 키는 NULL 타입을 거부한다(파티션=databaseId, 정렬=order).
  // non-row 페이지는 databaseId 가 null 이므로 속성 자체를 제거해 sparse GSI 에서 제외한다.
  // (NULL 타입으로 두면 Put/Update 모두 "Type mismatch ... actual: NULL" 로 거부된다.)
  if (input.databaseId == null) {
    delete input.databaseId;
  }
  // order 가 null/누락/비문자열이면 createdAt/updatedAt 기반 안정 키로 보정한다.
  normalizePageOrderField(input);
  // 보호 DB row 의 org/팀/프로젝트 scope 키를 비정규화해 sparse GSI 색인 대상으로 만든다.
  deriveDatabaseRowScopeKeys(input);
  preserveExistingDocForPlaceholderInput(input, existingPage);
  // dbCells 최후 방어선 — 협업 비-셀 업서트의 null dbCells 가 기존 셀을 비우지 못하게 보존.
  preserveExistingDbCellsForNullInput(input, existingPage);
  // 마지막 편집자 스탬프(§9.1) — 변경별 귀속이 아니라 페이지당 최종 편집자 1명.
  // 협업 모드의 materialize 도 이 upsertPage 경로를 타므로 caller 가 곧 편집 유발자.
  input.lastEditedByMemberId = args.caller.memberId;
  input.lastEditedByName = args.caller.name;
  // AWSJSON 필드 방어 정규화 — 객체로 도착한 doc/dbCells/blockComments 를 DynamoDB 저장 전
  // 문자열로 강제한다. 객체로 저장하면 깊은 본문이 DynamoDB 32레벨 중첩 한도를 초과해
  // "Nesting Levels have exceeded the supported limit" 로 거부된다(신규 페이지 생성 불가).
  // 이미 문자열이면 그대로 둔다(idempotent) — 정상 클라이언트 영향 없음.
  for (const key of ["doc", "dbCells", "blockComments"] as const) {
    const v = input[key];
    if (v != null && typeof v !== "string") {
      input[key] = JSON.stringify(v);
    }
  }
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
  // 작업 DB row 의 구성원별 색인 동기화 — listDatabaseRows 의 assigneeId 필터용.
  try {
    await syncLCDatabaseRowMemberIndexForPage({
      doc: args.doc,
      tables: args.tables,
      before: existingPage,
      after: saved,
    });
  } catch (err) {
    console.error("[upsertPage] LC database row member index sync failed", err);
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
  // rowPageOrder 는 Database 레코드에 저장하지 않는다(클라가 페이지의 databaseId 로 역추적).
  // 히스토리 스냅샷에만 싣기 위해 input 에서 분리·제거한 뒤, 아래 after 스냅샷에만 합친다.
  const incomingRowPageOrder = Array.isArray(args.input.rowPageOrder)
    ? (args.input.rowPageOrder as unknown[]).filter((v): v is string => typeof v === "string")
    : null;
  delete args.input.rowPageOrder;
  normalizeDatabaseAwsJsonFields(args.input);
  if ("templates" in args.input) {
    console.warn("[QN_TEMPLATE_SYNC] lambda upsertDatabase:input", {
      databaseId: id,
      workspaceId,
      updatedAt: args.input.updatedAt,
      templatesType: typeof args.input.templates,
      templatesLength:
        typeof args.input.templates === "string" ? args.input.templates.length : null,
    });
  }

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
    const templatesMerge = mergeStaleDatabaseTemplates(args.input, existingItem);
    if (templatesMerge) {
      console.warn("[QN_TEMPLATE_SYNC] lambda upsertDatabase:staleTemplatesMerge", {
        databaseId: id,
        workspaceId,
        incomingUpdatedAt,
        existingUpdatedAt,
      });
      try {
        await args.doc.send(
          new PutCommand({
            TableName: tableName,
            Item: templatesMerge,
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
            after: templatesMerge,
            kind: "database.update",
          });
        } catch (err) {
          console.error("[upsertDatabase] DatabaseHistory 기록 실패 (무시)", err);
        }
        await reconcileTemplateAutomationSchedules({
          before: existingItem,
          after: templatesMerge,
        });
        return templatesMerge;
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
    if ("templates" in args.input) {
      await reconcileTemplateAutomationSchedules({
        before: existingItem,
        after: existingItem,
      });
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
  if ("templates" in args.input) {
    console.warn("[QN_TEMPLATE_SYNC] lambda upsertDatabase:put", {
      databaseId: id,
      workspaceId,
      incomingUpdatedAt,
      existingUpdatedAt: existingUpdatedAt || null,
      templatesType: typeof merged.templates,
      templatesLength: typeof merged.templates === "string" ? merged.templates.length : null,
    });
  }

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
      // rowPageOrder 는 레코드(merged)에는 없고 히스토리 스냅샷에만 포함시킨다.
      after: incomingRowPageOrder ? { ...merged, rowPageOrder: incomingRowPageOrder } : merged,
      kind: existingItem ? "database.update" : "database.create",
    });
  } catch (err) {
    console.error("[upsertDatabase] DatabaseHistory 기록 실패 (무시)", err);
  }
  await reconcileTemplateAutomationSchedules({
    before: existingItem ?? null,
    after: merged,
  });
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
  /**
   * 지정 시 purgeAt(epoch seconds) 을 함께 기록한다(#1).
   * Pages 테이블에는 TTL(purgeAt)이 설정돼 있어 이 시각이 지나면 DynamoDB 가 자동·무료로 영구삭제한다.
   * (Databases 테이블에는 TTL 이 없으므로 전달하지 않는다.)
   */
  ttlSeconds?: number;
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
  const setPurge = typeof args.ttlSeconds === "number" && Number.isFinite(args.ttlSeconds);
  // byDatabaseAndOrder GSI 파티션 키(databaseId)가 NULL 타입으로 남아 있으면 Update 도
  // "Type mismatch ... actual: NULL" 로 거부된다. 기존 항목이 NULL databaseId 면 함께 제거한다.
  const removeNullDatabaseId =
    "databaseId" in existing.Item && existing.Item.databaseId == null;
  const setExpr = setPurge
    ? "SET deletedAt = :d, updatedAt = :u, purgeAt = :p"
    : "SET deletedAt = :d, updatedAt = :u";
  const r = await args.doc.send(
    new UpdateCommand({
      TableName: args.tableName,
      Key: { id: args.id },
      UpdateExpression: removeNullDatabaseId ? `${setExpr} REMOVE databaseId` : setExpr,
      ExpressionAttributeValues: {
        ":d": now,
        ":u": now,
        ":w": args.workspaceId,
        ...(setPurge ? { ":p": args.ttlSeconds } : {}),
      },
      // 삭제(휴지통 이동)는 사용자의 명시 의도이므로 updatedAt 낙관적 동시성 가드로 막지 않는다.
      // 과거 "updatedAt <= :old" 는 시계 skew·동시 편집·collab materialize 로 서버 updatedAt 이
      // 클라 삭제시각보다 최신이면 조건 실패 → softDelete 가 throw 되어 deletedAt 미설정 →
      // DB/페이지가 로컬에선 사라졌으나 서버엔 살아있고 휴지통에도 없는 유실이 간헐 발생했다.
      // 워크스페이스 일치만 확인한다(삭제는 복원 가능하므로 안전).
      ConditionExpression: "workspaceId = :w",
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
  // 휴지통 보관 만료 시각(epoch seconds)을 purgeAt 으로 기록 → DynamoDB TTL 자동 삭제(#1).
  // trash-purge Lambda 의 일일 풀스캔/개별 DeleteCommand 를 대체한다.
  const deleted = await softDeleteRecord({
    ...args,
    tableName: args.tables.Pages,
    ttlSeconds: Math.floor((Date.now() + TRASH_RETENTION_MS) / 1000),
  });
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
  try {
    await removeLCDatabaseRowMemberIndexForPage({
      doc: args.doc,
      tables: args.tables,
      page: deleted,
    });
  } catch (err) {
    console.error("[softDeletePage] LC database row member index remove failed", err);
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
  // 복원 시 TTL 자동삭제 예약(purgeAt)을 반드시 제거한다 — 안 그러면 복원해도 만료시각에 삭제된다(#1).
  delete next["purgeAt"];
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
    // 세션 엔트리는 post-state 전체 스냅샷을 직접 보유 — patch 재생 없이 그대로 사용.
    const eventSnapshot = parseJsonLike(event.snapshot);
    if (isPlainObject(eventSnapshot)) {
      snapshot = cloneJson(eventSnapshot);
      if (event.historyId === args.input.historyId) {
        found = true;
        break;
      }
      continue;
    }
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
  // byDatabaseAndOrder GSI는 NULL 타입 databaseId를 거부 — upsertPage와 동일하게 정제
  if (restored.databaseId == null) delete restored.databaseId;
  normalizePageOrderField(restored);
  deriveDatabaseRowScopeKeys(restored);
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

/** 현재 페이지 상태를 즉시 하나의 버전 체크포인트로 기록한다(세션 머지 우회 — 수동 "버전 저장"). */
export async function savePageVersion(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  input: { pageId: string; workspaceId: string };
}): Promise<Record<string, unknown>> {
  if (!args.tables.Pages) badRequest("Pages table 미설정");
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.input.workspaceId,
    required: "edit",
  });
  const existing = await args.doc.send(
    new GetCommand({ TableName: args.tables.Pages, Key: { id: args.input.pageId } }),
  );
  const page = (existing.Item as Record<string, unknown> | undefined) ?? null;
  if (!page) notFound("페이지 없음");
  await recordPageHistory({
    doc: args.doc,
    tables: args.tables,
    caller: args.caller,
    before: page,
    after: page,
    kind: "page.checkpoint",
    force: true,
  });
  return page;
}

/** 현재 DB 상태를 즉시 하나의 버전 체크포인트로 기록(세션 머지와 무관하게 새 버전 경계 생성).
 *  현재 행 페이지 id 목록(삭제·템플릿 제외)을 Pages 에서 조회해 rowPageOrder 로 채운다. */
export async function saveDatabaseVersion(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  input: { databaseId: string; workspaceId: string };
}): Promise<Record<string, unknown>> {
  if (!args.tables.Databases) badRequest("Databases table 미설정");
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.input.workspaceId,
    required: "edit",
  });
  const existing = await args.doc.send(
    new GetCommand({ TableName: args.tables.Databases, Key: { id: args.input.databaseId } }),
  );
  const database = (existing.Item as Record<string, unknown> | undefined) ?? null;
  if (!database) notFound("DB 없음");

  // 현재 행 페이지 id 목록을 byDatabaseAndOrder GSI 로 수집(soft-delete·템플릿 제외).
  const rowPageOrder: string[] = [];
  if (args.tables.Pages) {
    let nextKey: Record<string, unknown> | undefined;
    do {
      const r = await args.doc.send(
        new QueryCommand({
          TableName: args.tables.Pages,
          IndexName: "byDatabaseAndOrder",
          KeyConditionExpression: "databaseId = :d",
          FilterExpression:
            "workspaceId = :w AND (attribute_not_exists(deletedAt) OR attribute_type(deletedAt, :nullType) OR deletedAt = :empty)",
          ExpressionAttributeValues: {
            ":d": args.input.databaseId,
            ":w": args.input.workspaceId,
            ":empty": "",
            ":nullType": "NULL",
          },
          ScanIndexForward: true,
          ExclusiveStartKey: nextKey,
        }),
      );
      for (const item of (r.Items ?? []) as Record<string, unknown>[]) {
        // 템플릿 행(_qn_isTemplate 마커)은 행 목록에서 제외한다.
        // dbCells 는 AWSJSON(문자열)일 수 있으므로 parseJsonLike 로 파싱 후 검사.
        const cells = parseJsonLike(item.dbCells);
        if (isPlainObject(cells) && cells["_qn_isTemplate"] === "1") continue;
        if (typeof item.id === "string") rowPageOrder.push(item.id);
      }
      nextKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (nextKey);
  }

  await recordDatabaseHistory({
    doc: args.doc,
    tables: args.tables,
    caller: args.caller,
    before: database,
    after: { ...database, rowPageOrder },
    kind: "database.checkpoint",
    force: true,
  });
  return database;
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
    // 세션 엔트리는 post-state 전체 스냅샷을 직접 보유 — patch 재생 없이 그대로 사용.
    const eventSnapshot = parseJsonLike(event.snapshot);
    if (isPlainObject(eventSnapshot)) {
      snapshot = cloneJson(eventSnapshot);
      if (event.historyId === args.input.historyId) {
        found = true;
        break;
      }
      continue;
    }
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
  // rowPageOrder 는 Database 레코드에 저장하지 않는다(upsertDatabase 와 동일 규칙) — strip.
  // (삭제 행 additive 복구는 협업 Y룸 충돌로 보류 — 삭제 복구는 휴지통 경로 사용.)
  const restoredRowPageOrder = Array.isArray(snapshot.rowPageOrder)
    ? (snapshot.rowPageOrder as unknown[]).filter((v): v is string => typeof v === "string")
    : [];
  delete restored["rowPageOrder"];
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
      after: { ...restored, rowPageOrder: restoredRowPageOrder },
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
