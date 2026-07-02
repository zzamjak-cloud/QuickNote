import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { v4 as uuid } from "uuid";
import {
  badRequest,
  forbidden,
  notFound,
  requireWorkspaceAccess,
  type Member,
} from "../_auth";
import type { Tables } from "../member";
import {
  SESSION_PATCH_COMPACT_LIMIT,
  canMergeIntoSession,
  compactPatchOps,
  diffMeaningfulDatabaseUnits,
  diffMeaningfulPageUnits,
  mergeContributors,
} from "../historySession";
import { type Connection, cloneJson, isPlainObject, jsonEqual, parseJsonLike } from "./_shared";
import { deriveDatabaseRowScopeKeys, normalizePageOrderField } from "./row";

export const PAGE_HISTORY_FIELDS = [
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

// 히스토리 보존 기간 — DynamoDB TTL(expiresAt)이 지난 버전을 자동 삭제한다(삭제 무과금).
// 버전마다 전체 snapshot 을 보유해 무한 성장하므로 보존 기간으로 스토리지를 억제한다.
// ⚠ expiresAt 은 반드시 epoch **초**(밀리초 아님) — purgeAt 과 동일 규칙.
const HISTORY_RETENTION_DAYS = 180;
function historyExpiresAtSec(nowMs: number): number {
  return Math.floor(nowMs / 1000) + HISTORY_RETENTION_DAYS * 24 * 60 * 60;
}

export function normalizePageSnapshot(item: Record<string, unknown>): Record<string, unknown> {
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

export function requireDatabaseHistoryOwnerKey(caller: Member): string {
  if (!caller.cognitoSub) forbidden("DB 히스토리 owner key 없음");
  return caller.cognitoSub;
}

export async function listPageHistoryAsc(args: {
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

export async function listDatabaseHistoryAsc(args: {
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
export async function recordPageHistory(args: {
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
          expiresAt: historyExpiresAtSec(nowMs),
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
          expiresAt: historyExpiresAtSec(nowMs), // 세션 갱신 시 보존 기간도 연장
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
        expiresAt: historyExpiresAtSec(nowMs),
      },
    }),
  );
}

/** 행/페이지 soft delete 를 히스토리에 명시적으로 남긴다.
 *  (deletedAt 은 스냅샷 diff 로 잡히지 않으므로 일반 recordPageHistory 로는 기록되지 않는다.) */
export async function recordPageDeleteHistory(args: {
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
  const nowMs = Date.now();
  const createdAt = new Date(nowMs).toISOString();
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
        expiresAt: historyExpiresAtSec(nowMs),
      },
    }),
  );
}

/** 세션 머지 버전 기록(DB 구조) — 페이지와 동일 규칙. panelState 등 UI 휘발 상태는 버전 사유가 아니다. */
export async function recordDatabaseHistory(args: {
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
          expiresAt: historyExpiresAtSec(nowMs),
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
          expiresAt: historyExpiresAtSec(nowMs), // 세션 갱신 시 보존 기간도 연장
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
        expiresAt: historyExpiresAtSec(nowMs),
      },
    }),
  );
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
