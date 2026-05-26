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

const PAGE_HISTORY_ANCHOR_INTERVAL = 20;

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
  const history = await listPageHistoryAsc({ doc: args.doc, tableName, pageId });
  const patch = diffPageSnapshot(
    args.before ? normalizePageSnapshot(args.before) : null,
    normalizePageSnapshot(args.after),
  );
  if (patch.length === 0) return;
  const createdAt = new Date().toISOString();
  const shouldWriteAnchor = history.length === 0 || history.length % PAGE_HISTORY_ANCHOR_INTERVAL === 0;
  await args.doc.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        pageId,
        historyId: `${createdAt}#${uuid()}`,
        workspaceId,
        kind: args.kind,
        patch,
        ...(shouldWriteAnchor ? { anchor: normalizePageSnapshot(args.before ?? args.after) } : {}),
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
      });
    } catch (err) {
      console.error("[upsertPage] AssetUsage sync 실패 (무시)", err);
    }
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
  return upsertRecord({ ...args, tableName: args.tables.Databases });
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
  return softDeleteRecord({ ...args, tableName: args.tables.Pages });
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
  return softDeleteRecord({ ...args, tableName: args.tables.Databases });
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
