import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  badRequest,
  requireWorkspaceAccess,
  type Member,
} from "../_auth";
import type { Tables } from "../member";
import { syncPageAssetUsage } from "../asset";
import {
  removeLCScheduleIndexForPage,
  syncLCScheduleIndexForPage,
} from "../lcScheduleIndex";
import {
  removeLCDatabaseRowMemberIndexForPage,
  syncLCDatabaseRowMemberIndexForPage,
} from "../lcDatabaseRowMemberIndex";
import {
  type Connection,
  isPlainObject,
  parseJsonLike,
  jsonEqual,
  upsertRecord,
  softDeleteRecord,
} from "./_shared";
import { deriveDatabaseRowScopeKeys, normalizePageOrderField } from "./row";
import {
  recordPageHistory,
  recordPageDeleteHistory,
  normalizePageSnapshot,
  PAGE_HISTORY_FIELDS,
} from "./history";
import { preserveExistingDbCellsForNullInput } from "./database";
import { TRASH_RETENTION_MS } from "./trash";

const PAGE_META_INTERNAL_QUERY_MAX = 50;

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

/**
 * id 단독으로 페이지를 해석한다(workspaceId 를 모르는 멘션 대상 등).
 * Page 테이블은 id 단일 키이므로 먼저 조회한 뒤, 그 페이지의 workspaceId 로 view 권한을 검사한다.
 * 접근 권한이 없으면 requireWorkspaceAccess 가 거부(throw)한다.
 */
export async function getPageById(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  id: string;
}): Promise<Record<string, unknown> | null> {
  if (!args.tables.Pages) badRequest("Pages table 미설정");
  const r = await args.doc.send(
    new GetCommand({ TableName: args.tables.Pages, Key: { id: args.id } }),
  );
  const item = r.Item as Record<string, unknown> | undefined;
  if (!item) return null;
  const pageWorkspaceId = String(item["workspaceId"] ?? "");
  if (!pageWorkspaceId) return null;
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: pageWorkspaceId,
    required: "view",
  });
  return item;
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
