import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { badRequest, forbidden, requireWorkspaceAccess, type Member } from "./_auth";
import type { Tables } from "./member";

type MmScopeKind = "organization" | "team" | "project" | "other";
type MmEntryStatus = "draft" | "submitted" | "reviewed" | "locked";

type MmBucketRecord = {
  id: string;
  kind: MmScopeKind;
  scopeId?: string | null;
  label: string;
  ratioBp: number;
  editable: boolean;
  reasons: Array<{
    date: string;
    type: "holiday" | "leave" | "empty" | "unclassified";
    label: string;
    ratioBp: number;
  }>;
};

type MmEntryRecord = {
  recordType: "entry";
  id: string;
  workspaceId: string;
  memberId: string;
  weekStart: string;
  weekEnd: string;
  status: MmEntryStatus;
  buckets: MmBucketRecord[];
  sourceSnapshot?: string | null;
  organizationId?: string | null;
  teamId?: string | null;
  submittedByMemberId: string;
  submittedAt: string;
  updatedAt: string;
  reviewedByMemberId?: string | null;
  reviewedAt?: string | null;
  lockedByMemberId?: string | null;
  lockedAt?: string | null;
  note?: string | null;
};

type MmRevisionRecord = {
  recordType: "revision";
  id: string;
  entryId: string;
  workspaceId: string;
  memberId: string;
  weekStart: string;
  actorMemberId: string;
  action: "submit" | "review" | "lock" | "unlock";
  before?: string | null;
  after?: string | null;
  createdAt: string;
  note?: string | null;
};

type MmEntryInput = {
  workspaceId: string;
  memberId: string;
  weekStart: string;
  weekEnd: string;
  buckets: MmBucketRecord[];
  sourceSnapshot?: unknown;
  organizationId?: string | null;
  teamId?: string | null;
  note?: string | null;
};

const ADMIN_ROLES = new Set(["developer", "owner", "leader", "manager"]);

function entryId(workspaceId: string, memberId: string, weekStart: string): string {
  return `mm:${workspaceId}:${memberId}:${weekStart}`;
}

function revisionId(entry: MmEntryRecord, action: string, now: string): string {
  return `mmrev:${entry.id}:${now}:${action}`;
}

function isAdmin(caller: Member): boolean {
  return ADMIN_ROLES.has(caller.workspaceRole);
}

function normalizeKind(kind: string): MmScopeKind {
  const k = kind.toLowerCase();
  if (k === "organization" || k === "team" || k === "project" || k === "other") return k;
  badRequest("MM bucket kind 값이 올바르지 않습니다");
}

function normalizeReasonType(type: string): "holiday" | "leave" | "empty" | "unclassified" {
  const t = type.toLowerCase();
  if (t === "holiday" || t === "leave" || t === "empty" || t === "unclassified") return t;
  badRequest("MM 기타 사유 타입이 올바르지 않습니다");
}

function normalizeBuckets(rawBuckets: unknown): MmBucketRecord[] {
  if (!Array.isArray(rawBuckets)) badRequest("MM bucket 배열이 필요합니다");
  const buckets = rawBuckets.map((raw) => {
    const b = raw as Record<string, unknown>;
    const ratioBp = Number(b.ratioBp ?? 0);
    if (!Number.isFinite(ratioBp) || ratioBp < 0 || ratioBp > 10_000) {
      badRequest("MM 비율은 0 이상 10000 이하입니다");
    }
    return {
      id: String(b.id ?? ""),
      kind: normalizeKind(String(b.kind ?? "")),
      scopeId: typeof b.scopeId === "string" ? b.scopeId : null,
      label: String(b.label ?? ""),
      ratioBp: Math.round(ratioBp),
      editable: Boolean(b.editable),
      reasons: Array.isArray(b.reasons)
        ? b.reasons.map((reason) => {
            const r = reason as Record<string, unknown>;
            return {
              date: String(r.date ?? ""),
              type: normalizeReasonType(String(r.type ?? "")),
              label: String(r.label ?? ""),
              ratioBp: Math.round(Number(r.ratioBp ?? 0)),
            };
          })
        : [],
    };
  });
  if (buckets.some((bucket) => !bucket.id || !bucket.label)) {
    badRequest("MM bucket id/label 은 필수입니다");
  }
  const total = buckets.reduce((sum, bucket) => sum + bucket.ratioBp, 0);
  if (total !== 10_000) badRequest("주간 MM 합계가 100%가 되어야 합니다");
  return buckets;
}

function normalizeJson(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    badRequest("sourceSnapshot JSON 직렬화에 실패했습니다");
  }
}

async function getEntry(
  doc: DynamoDBDocumentClient,
  tables: Tables,
  id: string,
  workspaceId: string,
): Promise<MmEntryRecord | null> {
  const r = await doc.send(new GetCommand({ TableName: tables.MmEntries!, Key: { id, workspaceId } }));
  return (r.Item as MmEntryRecord | undefined) ?? null;
}

async function writeRevision(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  entry: MmEntryRecord;
  action: MmRevisionRecord["action"];
  actorMemberId: string;
  before?: MmEntryRecord | null;
  after?: MmEntryRecord | null;
  note?: string | null;
  now: string;
}): Promise<void> {
  const item: MmRevisionRecord = {
    recordType: "revision",
    id: revisionId(args.entry, args.action, args.now),
    entryId: args.entry.id,
    workspaceId: args.entry.workspaceId,
    memberId: args.entry.memberId,
    weekStart: args.entry.weekStart,
    actorMemberId: args.actorMemberId,
    action: args.action,
    before: args.before ? JSON.stringify(args.before) : null,
    after: args.after ? JSON.stringify(args.after) : null,
    createdAt: args.now,
    note: args.note ?? null,
  };
  await args.doc.send(new PutCommand({ TableName: args.tables.MmEntries!, Item: item }));
}

async function assertCanView(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  workspaceId: string;
}): Promise<void> {
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "view",
  });
}

function assertCanEdit(caller: Member, targetMemberId: string): void {
  if (caller.memberId === targetMemberId) return;
  if (isAdmin(caller)) return;
  forbidden("다른 구성원의 MM 정보는 수정할 수 없습니다");
}

function assertAdmin(caller: Member): void {
  if (!isAdmin(caller)) forbidden("MM 관리 권한이 필요합니다");
}

export async function listMmEntries(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  workspaceId: string;
  fromWeekStart: string;
  toWeekStart: string;
  memberId?: string | null;
}): Promise<MmEntryRecord[]> {
  await assertCanView(args);
  const r = await args.doc.send(
    new QueryCommand({
      TableName: args.tables.MmEntries!,
      IndexName: "byWorkspaceAndWeek",
      KeyConditionExpression: "workspaceId = :w AND weekStart BETWEEN :f AND :t",
      FilterExpression: args.memberId
        ? "recordType = :rt AND memberId = :m"
        : "recordType = :rt",
      ExpressionAttributeValues: {
        ":w": args.workspaceId,
        ":f": args.fromWeekStart,
        ":t": args.toWeekStart,
        ":rt": "entry",
        ...(args.memberId ? { ":m": args.memberId } : {}),
      },
    }),
  );
  return ((r.Items ?? []) as MmEntryRecord[]).sort((a, b) =>
    a.weekStart.localeCompare(b.weekStart) || a.memberId.localeCompare(b.memberId),
  );
}

export async function listMmRevisions(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  workspaceId: string;
  entryId: string;
}): Promise<MmRevisionRecord[]> {
  await assertCanView(args);
  const r = await args.doc.send(
    new QueryCommand({
      TableName: args.tables.MmEntries!,
      IndexName: "byEntry",
      KeyConditionExpression: "entryId = :e",
      ExpressionAttributeValues: { ":e": args.entryId },
    }),
  );
  return ((r.Items ?? []) as MmRevisionRecord[]).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function upsertMmEntry(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  input: MmEntryInput;
}): Promise<MmEntryRecord> {
  await assertCanView({ ...args, workspaceId: args.input.workspaceId });
  assertCanEdit(args.caller, args.input.memberId);
  const id = entryId(args.input.workspaceId, args.input.memberId, args.input.weekStart);
  const before = await getEntry(args.doc, args.tables, id, args.input.workspaceId);
  if (before?.status === "locked") forbidden("잠금된 MM은 먼저 잠금 해제해야 합니다");
  const now = new Date().toISOString();
  const item: MmEntryRecord = {
    recordType: "entry",
    id,
    workspaceId: args.input.workspaceId,
    memberId: args.input.memberId,
    weekStart: args.input.weekStart,
    weekEnd: args.input.weekEnd,
    status: "submitted",
    buckets: normalizeBuckets(args.input.buckets),
    sourceSnapshot: normalizeJson(args.input.sourceSnapshot),
    organizationId: args.input.organizationId ?? before?.organizationId ?? null,
    teamId: args.input.teamId ?? before?.teamId ?? null,
    submittedByMemberId: args.caller.memberId,
    submittedAt: before?.submittedAt ?? now,
    updatedAt: now,
    note: args.input.note ?? before?.note ?? null,
  };
  await args.doc.send(new PutCommand({ TableName: args.tables.MmEntries!, Item: item }));
  await writeRevision({
    doc: args.doc,
    tables: args.tables,
    entry: item,
    action: "submit",
    actorMemberId: args.caller.memberId,
    before,
    after: item,
    note: args.input.note,
    now,
  });
  return item;
}

export async function reviewMmEntry(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  input: { workspaceId: string; entryId: string; buckets?: MmBucketRecord[] | null; note?: string | null };
}): Promise<MmEntryRecord> {
  await assertCanView({ ...args, workspaceId: args.input.workspaceId });
  assertAdmin(args.caller);
  const before = await getEntry(args.doc, args.tables, args.input.entryId, args.input.workspaceId);
  if (!before) badRequest("MM 항목을 찾을 수 없습니다");
  if (before.status === "locked") forbidden("잠금된 MM은 먼저 잠금 해제해야 합니다");
  const now = new Date().toISOString();
  const r = await args.doc.send(
    new UpdateCommand({
      TableName: args.tables.MmEntries!,
      Key: { id: args.input.entryId, workspaceId: args.input.workspaceId },
      UpdateExpression: "SET #st = :s, buckets = :b, reviewedByMemberId = :rb, reviewedAt = :ra, updatedAt = :u, note = :n",
      ExpressionAttributeNames: { "#st": "status" },
      ExpressionAttributeValues: {
        ":s": "reviewed",
        ":b": args.input.buckets ? normalizeBuckets(args.input.buckets) : before.buckets,
        ":rb": args.caller.memberId,
        ":ra": now,
        ":u": now,
        ":n": args.input.note ?? before.note ?? null,
      },
      ReturnValues: "ALL_NEW",
    }),
  );
  const after = r.Attributes as MmEntryRecord;
  await writeRevision({
    doc: args.doc,
    tables: args.tables,
    entry: after,
    action: "review",
    actorMemberId: args.caller.memberId,
    before,
    after,
    note: args.input.note,
    now,
  });
  return after;
}

export async function setMmEntryLock(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  workspaceId: string;
  entryId: string;
  locked: boolean;
  note?: string | null;
}): Promise<MmEntryRecord> {
  await assertCanView(args);
  assertAdmin(args.caller);
  const before = await getEntry(args.doc, args.tables, args.entryId, args.workspaceId);
  if (!before) badRequest("MM 항목을 찾을 수 없습니다");
  const now = new Date().toISOString();
  const status = args.locked ? "locked" : "reviewed";
  const update = args.locked
    ? "SET #st = :s, lockedByMemberId = :lb, lockedAt = :la, updatedAt = :u, note = :n"
    : "SET #st = :s, updatedAt = :u, note = :n REMOVE lockedByMemberId, lockedAt";
  const values: Record<string, unknown> = args.locked
    ? { ":s": status, ":lb": args.caller.memberId, ":la": now, ":u": now, ":n": args.note ?? before.note ?? null }
    : { ":s": status, ":u": now, ":n": args.note ?? before.note ?? null };
  const r = await args.doc.send(
    new UpdateCommand({
      TableName: args.tables.MmEntries!,
      Key: { id: args.entryId, workspaceId: args.workspaceId },
      UpdateExpression: update,
      ExpressionAttributeNames: { "#st": "status" },
      ExpressionAttributeValues: values,
      ReturnValues: "ALL_NEW",
    }),
  );
  const after = r.Attributes as MmEntryRecord;
  await writeRevision({
    doc: args.doc,
    tables: args.tables,
    entry: after,
    action: args.locked ? "lock" : "unlock",
    actorMemberId: args.caller.memberId,
    before,
    after,
    note: args.note,
    now,
  });
  return after;
}
