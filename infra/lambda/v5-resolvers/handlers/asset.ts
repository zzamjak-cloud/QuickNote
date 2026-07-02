// 자산(이미지/파일) 관리 핸들러.
// - listMyAssets : 사용자가 소유한 자산 목록 (크기/생성일 정렬, MIME/미사용 필터)
// - getAssetUsages : 자산이 어느 페이지·블록에서 쓰이는지
// - deleteMyAssets : 다중 영구 삭제 (S3 + ImageAssets + AssetUsage)
// - replaceAssetRef : 페이지 doc 내부의 자산 참조를 교체 (압축/변환 후 호출)
// - migrateAssetUsage : 기존 페이지를 전부 스캔해 AssetUsage 인덱스를 재구성
//
// 또한 페이지 mutation 후처리용 helper (syncPageAssetUsage / cascadeDeletePageAssetUsage) 를 export 한다.

import {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
  type ScanCommandInput,
  PutCommand,
  DeleteCommand,
  GetCommand,
  BatchWriteCommand,
  BatchGetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import type { Tables } from "./member";
import { badRequest, notFound, unauthorized } from "./_auth";

const s3 = new S3Client({});

// 자산 ref 스킴 ↔ assetId 변환.
const IMAGE_SCHEME = "quicknote-image://";
const FILE_SCHEME = "quicknote-file://";

export type AssetRef = { assetId: string; blockId?: string; blockType?: string };

type AssetUsageRow = {
  assetId?: string;
  sk?: string;
  ownerId?: string;
  pageId?: string;
  workspaceId?: string;
  [key: string]: unknown;
};

async function filterLivePageUsages(
  doc: DynamoDBDocumentClient,
  pagesTable: string | undefined,
  usages: AssetUsageRow[],
): Promise<AssetUsageRow[]> {
  if (!pagesTable || usages.length === 0) return usages;
  // 커스텀 아이콘 라이브러리 등 페이지에 종속되지 않은 사용 row 는 그대로 보존한다.
  const passthroughBlockTypes = new Set(["customIcon"]);
  const passthrough: AssetUsageRow[] = [];
  const pageBound: AssetUsageRow[] = [];
  for (const u of usages) {
    const bt = typeof u.blockType === "string" ? u.blockType : null;
    if (bt && passthroughBlockTypes.has(bt)) passthrough.push(u);
    else pageBound.push(u);
  }
  if (pageBound.length === 0) return passthrough;
  const pageIds = Array.from(new Set(pageBound.map((u) => u.pageId).filter((id): id is string => Boolean(id))));
  if (pageIds.length === 0) return passthrough;

  const livePageIds = new Set<string>();
  for (let i = 0; i < pageIds.length; i += 100) {
    const keys = pageIds.slice(i, i + 100).map((id) => ({ id }));
    const res = await doc.send(
      new BatchGetCommand({
        RequestItems: {
          [pagesTable]: {
            Keys: keys,
            ProjectionExpression: "id, deletedAt",
          },
        },
      }),
    );
    for (const item of (res.Responses?.[pagesTable] ?? []) as Array<{ id?: unknown; deletedAt?: unknown }>) {
      if (typeof item.id === "string" && (item.deletedAt == null || item.deletedAt === "")) {
        livePageIds.add(item.id);
      }
    }
  }

  const liveBound = pageBound.filter((u) => typeof u.pageId === "string" && livePageIds.has(u.pageId));
  return [...liveBound, ...passthrough];
}

/** 페이지 doc(JSON 문자열 또는 객체) 내부의 모든 자산 참조를 평탄화해 수집. */
export function extractAssetRefs(docJson: unknown): AssetRef[] {
  if (!docJson) return [];
  const root = typeof docJson === "string" ? safeJsonParse(docJson) : docJson;
  if (!root || typeof root !== "object") return [];
  const out: AssetRef[] = [];
  walk(root, out, null);
  return out;
}

/**
 * 페이지 dbCells (Record<columnId, CellValue>) 의 모든 자산 참조를 수집.
 * FileCellItem 형태 ({fileId, src: "quicknote-(image|file)://...", name, mime, size}) 의 src 를 본다.
 * dbCells 는 page.doc 트리에 포함되지 않으므로 extractAssetRefs 로는 탐지되지 않는다.
 * blockId 는 `db:{columnId}:{fileId}` 형태로 인덱싱해 동일 행 내 셀별 ref 가 중복 dedupe 되지 않도록 한다.
 */
export function extractDbCellAssetRefs(dbCells: unknown): AssetRef[] {
  if (!dbCells || typeof dbCells !== "object") return [];
  const root = typeof dbCells === "string" ? safeJsonParse(dbCells as unknown as string) : dbCells;
  if (!root || typeof root !== "object" || Array.isArray(root)) return [];
  const out: AssetRef[] = [];
  for (const [colId, value] of Object.entries(root as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const src = typeof rec.src === "string" ? rec.src : null;
      if (!src) continue;
      const assetId = assetIdFromRef(src);
      if (!assetId) continue;
      const fileId = typeof rec.fileId === "string" ? rec.fileId : "";
      out.push({
        assetId,
        blockId: `db:${colId}:${fileId}`,
        blockType: "dbCellFile",
      });
    }
  }
  return out;
}

function walk(node: unknown, out: AssetRef[], parentBlockType: string | null): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, out, parentBlockType);
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  const type = typeof obj.type === "string" ? (obj.type as string) : parentBlockType;
  const attrs = obj.attrs && typeof obj.attrs === "object" ? (obj.attrs as Record<string, unknown>) : null;
  if (attrs) {
    const src = typeof attrs.src === "string" ? attrs.src : null;
    const assetId = src ? assetIdFromRef(src) : null;
    if (assetId) {
      const blockId = typeof attrs.id === "string" ? attrs.id : typeof attrs.blockId === "string" ? attrs.blockId : undefined;
      out.push({ assetId, blockId, blockType: type ?? undefined });
    }
  }
  if (Array.isArray(obj.content)) walk(obj.content, out, type);
}

function assetIdFromRef(src: string): string | null {
  if (src.startsWith(IMAGE_SCHEME)) return src.slice(IMAGE_SCHEME.length).split("?")[0]!.split("#")[0]!;
  if (src.startsWith(FILE_SCHEME)) return src.slice(FILE_SCHEME.length).split("?")[0]!.split("#")[0]!;
  return null;
}

/** 단일 문자열 (page.icon, page.coverImage 등) 에서 assetId 추출. */
export function extractAssetIdFromString(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") return null;
  return assetIdFromRef(value);
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function requireTable(name: string | undefined, label: string): string {
  if (!name) throw new Error(`${label} 환경 변수 미설정`);
  return name;
}

function requireCognitoSub(caller: { cognitoSub?: string | null; memberId?: string }): string {
  if (caller.cognitoSub) return caller.cognitoSub;
  throw unauthorized("cognitoSub 누락 — 자산 소유자 식별 불가");
}

// ===== AssetUsage 키 헬퍼 =====
function usageSk(pageId: string, blockId: string | undefined): string {
  return `PAGE#${pageId}#BLOCK#${blockId ?? "_"}`;
}

// ===== 페이지 mutation 후처리 =====

/**
 * 단일 페이지의 AssetUsage 인덱스를 doc 기준으로 재구성한다.
 * - 기존 pageId 의 모든 사용 row 를 byPage GSI 로 조회 → 삭제
 * - doc 에서 추출한 새로운 ref 들을 PUT
 * upsertPage / restorePage 직후 호출.
 */
export async function syncPageAssetUsage(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  ownerId: string;
  workspaceId: string;
  pageId: string;
  pageTitle?: string | null;
  pageDoc: unknown;
  pageIcon?: string | null;
  pageCoverImage?: string | null;
  /** DB 행 페이지의 셀 값 — 파일 컬럼(FileCellItem[]) 의 src 까지 인덱싱한다. */
  pageDbCells?: unknown;
}): Promise<void> {
  const tableName = args.tables.AssetUsage;
  if (!tableName) return; // 테이블 미설정 환경에서는 silently skip (점진적 배포 대비)
  // 1) 기존 rows 삭제
  await deletePageAssetUsageRows(args.doc, tableName, args.pageId);
  // 2) 새 rows 추가 (자산 ref 가 있을 때만)
  //    doc 본문 + page.icon + page.coverImage + dbCells 파일 컬럼까지 모두 인덱싱해
  //    DB 행의 파일/이미지/영상 첨부와 커스텀 아이콘이 "사용 안 됨" 으로 잘못 분류되는 회귀를 방지.
  const refs = extractAssetRefs(args.pageDoc);
  for (const r of extractDbCellAssetRefs(args.pageDbCells)) refs.push(r);
  const iconAssetId = extractAssetIdFromString(args.pageIcon);
  if (iconAssetId) refs.push({ assetId: iconAssetId, blockType: "pageIcon" });
  const coverAssetId = extractAssetIdFromString(args.pageCoverImage);
  if (coverAssetId) refs.push({ assetId: coverAssetId, blockType: "pageCover" });
  if (refs.length === 0) return;
  // dedupe by (assetId, blockId)
  const seen = new Set<string>();
  const items: Array<Record<string, unknown>> = [];
  for (const ref of refs) {
    const sk = usageSk(args.pageId, ref.blockId);
    const dedupeKey = `${ref.assetId}|${sk}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    items.push({
      assetId: ref.assetId,
      sk,
      ownerId: args.ownerId,
      pageId: args.pageId,
      blockId: ref.blockId ?? null,
      blockType: ref.blockType ?? null,
      workspaceId: args.workspaceId,
      pageTitle: args.pageTitle ?? null,
      updatedAt: new Date().toISOString(),
    });
  }
  await batchWriteChunks(args.doc, tableName, items);
}

/** permanentlyDeletePage / emptyTrash 시 — 해당 페이지의 모든 AssetUsage row 제거. */
export async function cascadeDeletePageAssetUsage(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  pageId: string;
}): Promise<void> {
  const tableName = args.tables.AssetUsage;
  if (!tableName) return;
  await deletePageAssetUsageRows(args.doc, tableName, args.pageId);
}

async function deletePageAssetUsageRows(
  doc: DynamoDBDocumentClient,
  tableName: string,
  pageId: string,
): Promise<void> {
  // byPage GSI 로 pageId 의 모든 row 조회 → BatchWrite 로 삭제.
  // 한 페이지의 사용 row 는 보통 수십 개 이내라 페이지네이션 1~2회로 충분.
  let exclusiveStartKey: Record<string, unknown> | undefined = undefined;
  const keysToDelete: Array<{ assetId: string; sk: string }> = [];
  do {
    const res = await doc.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: "byPage",
        KeyConditionExpression: "pageId = :p",
        ExpressionAttributeValues: { ":p": pageId },
        ProjectionExpression: "assetId, sk",
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    const items = (res.Items ?? []) as Array<Record<string, unknown>>;
    for (const it of items) {
      const aid = it.assetId as string | undefined;
      const sk = it.sk as string | undefined;
      if (aid && sk) keysToDelete.push({ assetId: aid, sk });
    }
    exclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);

  // BatchWrite 25개 단위 삭제
  for (let i = 0; i < keysToDelete.length; i += 25) {
    const chunk = keysToDelete.slice(i, i + 25);
    await doc.send(
      new BatchWriteCommand({
        RequestItems: {
          [tableName]: chunk.map((k) => ({
            DeleteRequest: { Key: { assetId: k.assetId, sk: k.sk } },
          })),
        },
      }),
    );
  }
}

async function batchWriteChunks(
  doc: DynamoDBDocumentClient,
  tableName: string,
  items: Array<Record<string, unknown>>,
): Promise<void> {
  for (let i = 0; i < items.length; i += 25) {
    const chunk = items.slice(i, i + 25);
    await doc.send(
      new BatchWriteCommand({
        RequestItems: {
          [tableName]: chunk.map((item) => ({ PutRequest: { Item: item } })),
        },
      }),
    );
  }
}

// ===== Queries =====

export type ListMyAssetsInput = {
  sortBy?: "SIZE_DESC" | "SIZE_ASC" | "CREATED_AT_DESC";
  filterMimePrefix?: string;
  filterUnusedOnly?: boolean;
  minSize?: number;
  limit?: number;
  nextToken?: string;
};

export async function listMyAssets(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: { memberId: string; cognitoSub?: string | null };
  input?: ListMyAssetsInput | null;
}): Promise<{ items: Array<Record<string, unknown>>; nextToken: string | null }> {
  const imageAssets = requireTable(args.tables.ImageAssets, "IMAGE_ASSETS_TABLE_NAME");
  const usageTable = args.tables.AssetUsage; // optional
  const input = args.input ?? {};
  const ownerId = requireCognitoSub(args.caller);

  // 1) 모든 자산 페치 (paginated). 사용자당 자산 수는 보통 수천 이내라 안전.
  type Asset = {
    id: string;
    ownerId: string;
    mimeType: string;
    size: number;
    sha256: string;
    status: string;
    createdAt: string;
    name?: string | null;
    compressed?: boolean | null;
  };
  const all: Asset[] = [];
  let startKey: Record<string, unknown> | undefined = undefined;
  do {
    const res = await args.doc.send(
      new QueryCommand({
        TableName: imageAssets,
        IndexName: "byOwner",
        KeyConditionExpression: "ownerId = :o",
        ExpressionAttributeValues: { ":o": ownerId },
        ExclusiveStartKey: startKey,
      }),
    );
    for (const it of (res.Items ?? []) as Asset[]) {
      if (it && typeof it.id === "string") all.push(it);
    }
    startKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);

  // 2) usageCount 집계 (AssetUsage byOwner GSI)
  const usageCount = new Map<string, number>();
  if (usageTable) {
    const usageRows: AssetUsageRow[] = [];
    let usageStartKey: Record<string, unknown> | undefined = undefined;
    do {
      const res = await args.doc.send(
        new QueryCommand({
          TableName: usageTable,
          IndexName: "byOwner",
          KeyConditionExpression: "ownerId = :o",
          ExpressionAttributeValues: { ":o": ownerId },
          ProjectionExpression: "assetId, pageId",
          ExclusiveStartKey: usageStartKey,
        }),
      );
      usageRows.push(...((res.Items ?? []) as AssetUsageRow[]));
      usageStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (usageStartKey);
    const liveUsageRows = await filterLivePageUsages(args.doc, args.tables.Pages, usageRows);
    for (const it of liveUsageRows) {
      if (it.assetId) usageCount.set(it.assetId, (usageCount.get(it.assetId) ?? 0) + 1);
    }
  }

  // 3) 필터
  let filtered = all.filter((a) => a.status === "READY");
  if (input.filterMimePrefix) {
    const prefix = input.filterMimePrefix;
    filtered = filtered.filter((a) => a.mimeType.startsWith(prefix));
  }
  if (typeof input.minSize === "number" && input.minSize > 0) {
    const min = input.minSize;
    filtered = filtered.filter((a) => a.size >= min);
  }
  if (input.filterUnusedOnly) {
    filtered = filtered.filter((a) => !usageCount.has(a.id));
  }

  // 4) 정렬
  const sortBy = input.sortBy ?? "SIZE_DESC";
  filtered.sort((a, b) => {
    if (sortBy === "SIZE_DESC") return b.size - a.size;
    if (sortBy === "SIZE_ASC") return a.size - b.size;
    return b.createdAt.localeCompare(a.createdAt);
  });

  // 5) 페이지네이션 — 클라이언트 측 cursor.
  const limit = Math.max(1, Math.min(500, input.limit ?? 200));
  const startIdx = input.nextToken ? Math.max(0, parseInt(input.nextToken, 10) || 0) : 0;
  const slice = filtered.slice(startIdx, startIdx + limit);
  const nextToken = startIdx + limit < filtered.length ? String(startIdx + limit) : null;

  return {
    items: slice.map((a) => ({
      ...a,
      usageCount: usageCount.get(a.id) ?? 0,
    })),
    nextToken,
  };
}

export async function getAssetUsages(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: { memberId: string; cognitoSub?: string | null };
  assetId: string;
}): Promise<Array<Record<string, unknown>>> {
  const usageTable = args.tables.AssetUsage;
  if (!usageTable) return [];
  const ownerId = requireCognitoSub(args.caller);
  const res = await args.doc.send(
    new QueryCommand({
      TableName: usageTable,
      KeyConditionExpression: "assetId = :a",
      ExpressionAttributeValues: { ":a": args.assetId },
    }),
  );
  const items = (res.Items ?? []) as AssetUsageRow[];
  // ownerId 본인 자산의 사용 위치만 반환 (cross-user 보호)
  const ownedItems = items.filter((it) => it.ownerId === ownerId);
  return filterLivePageUsages(args.doc, args.tables.Pages, ownedItems);
}

// ===== Mutations =====

/**
 * 자산의 표시용 이름(name) 을 변경. 소유자 검증 후 ImageAssets row 의 name 만 UpdateCommand 로 patch.
 * name 이 빈 문자열·null 이면 필드를 제거(REMOVE)해 다시 id 표시 폴백으로 돌아간다.
 */
export async function renameAsset(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: { memberId: string; cognitoSub?: string | null };
  assetId: string;
  name: string | null;
}): Promise<Record<string, unknown>> {
  const imageAssets = requireTable(args.tables.ImageAssets, "IMAGE_ASSETS_TABLE_NAME");
  const ownerId = requireCognitoSub(args.caller);
  if (!args.assetId) throw badRequest("assetId 필수");
  const existing = await args.doc.send(
    new GetCommand({ TableName: imageAssets, Key: { id: args.assetId } }),
  );
  const asset = existing.Item as { id?: string; ownerId?: string } | undefined;
  if (!asset) throw notFound("자산 없음");
  if (asset.ownerId !== ownerId) throw unauthorized("다른 사용자의 자산은 수정할 수 없습니다");
  const trimmed = typeof args.name === "string" ? args.name.trim() : "";
  if (trimmed.length === 0) {
    const res = await args.doc.send(
      new UpdateCommand({
        TableName: imageAssets,
        Key: { id: args.assetId },
        UpdateExpression: "REMOVE #n",
        ExpressionAttributeNames: { "#n": "name" },
        ReturnValues: "ALL_NEW",
      }),
    );
    return (res.Attributes ?? {}) as Record<string, unknown>;
  }
  // DynamoDB 항목 한도 보호 — 자산 이름이 비정상적으로 길지 않도록 컷.
  const safeName = trimmed.slice(0, 256);
  const res = await args.doc.send(
    new UpdateCommand({
      TableName: imageAssets,
      Key: { id: args.assetId },
      UpdateExpression: "SET #n = :n",
      ExpressionAttributeNames: { "#n": "name" },
      ExpressionAttributeValues: { ":n": safeName },
      ReturnValues: "ALL_NEW",
    }),
  );
  return (res.Attributes ?? {}) as Record<string, unknown>;
}

export async function deleteMyAssets(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: { memberId: string; cognitoSub?: string | null };
  assetIds: string[];
}): Promise<string[]> {
  if (!Array.isArray(args.assetIds) || args.assetIds.length === 0) {
    throw badRequest("assetIds 비어 있음");
  }
  const imageAssets = requireTable(args.tables.ImageAssets, "IMAGE_ASSETS_TABLE_NAME");
  const bucket = requireTable(args.tables.ImagesBucketName, "IMAGES_BUCKET_NAME");
  const ownerId = requireCognitoSub(args.caller);
  const deleted: string[] = [];

  // 동시 처리 — 청크 단위로 병렬 (S3 + DDB), 한 자산 실패가 전체를 막지 않도록 each catch.
  const concurrency = 4;
  const queue = [...args.assetIds];
  async function worker() {
    while (queue.length > 0) {
      const id = queue.shift();
      if (!id) return;
      try {
        // 1) 소유자 검증
        const existing = await args.doc.send(
          new GetCommand({ TableName: imageAssets, Key: { id } }),
        );
        const asset = existing.Item as { id: string; ownerId?: string; key?: string } | undefined;
        if (!asset) {
          // 이미 사라짐 — 성공으로 간주
          deleted.push(id);
          continue;
        }
        if (asset.ownerId !== ownerId) {
          throw unauthorized("다른 사용자의 자산은 삭제할 수 없습니다");
        }
        // 2) S3 객체 삭제 (key 필드 사용)
        if (asset.key) {
          await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: asset.key }));
        }
        // 3) AssetUsage cascade — assetId 의 모든 row 제거
        await deleteAllUsagesForAsset(args.doc, args.tables, id);
        // 4) ImageAssets row 삭제
        await args.doc.send(
          new DeleteCommand({
            TableName: imageAssets,
            Key: { id },
            ConditionExpression: "ownerId = :o",
            ExpressionAttributeValues: { ":o": ownerId },
          }),
        );
        deleted.push(id);
      } catch (err) {
        console.error("[deleteMyAssets] 실패", { id, err });
        // 한 자산 실패는 전체 응답에 노출되지 않음 (deleted 배열에서 빠짐)
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return deleted;
}

async function deleteAllUsagesForAsset(
  doc: DynamoDBDocumentClient,
  tables: Tables,
  assetId: string,
): Promise<void> {
  const usageTable = tables.AssetUsage;
  if (!usageTable) return;
  let startKey: Record<string, unknown> | undefined = undefined;
  const keys: Array<{ assetId: string; sk: string }> = [];
  do {
    const res = await doc.send(
      new QueryCommand({
        TableName: usageTable,
        KeyConditionExpression: "assetId = :a",
        ExpressionAttributeValues: { ":a": assetId },
        ProjectionExpression: "assetId, sk",
        ExclusiveStartKey: startKey,
      }),
    );
    for (const it of (res.Items ?? []) as Array<{ assetId?: string; sk?: string }>) {
      if (it.assetId && it.sk) keys.push({ assetId: it.assetId, sk: it.sk });
    }
    startKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);
  for (let i = 0; i < keys.length; i += 25) {
    const chunk = keys.slice(i, i + 25);
    await doc.send(
      new BatchWriteCommand({
        RequestItems: {
          [usageTable]: chunk.map((k) => ({
            DeleteRequest: { Key: { assetId: k.assetId, sk: k.sk } },
          })),
        },
      }),
    );
  }
}

/**
 * 페이지 doc 내부의 자산 ref 를 oldAssetId → newAssetId 로 교체.
 * AssetUsage 의 byPage GSI 로 영향받는 페이지를 찾아, 페이지 doc 의 JSON 문자열에서
 * `quicknote-image://{old}`, `quicknote-file://{old}` 를 일괄 치환 후 저장.
 * 변경된 페이지의 AssetUsage 도 재구성.
 */
export async function replaceAssetRef(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: { memberId: string; cognitoSub?: string | null };
  input: { oldAssetId: string; newAssetId: string };
}): Promise<number> {
  const { oldAssetId, newAssetId } = args.input;
  if (!oldAssetId || !newAssetId) throw badRequest("oldAssetId/newAssetId 누락");
  if (oldAssetId === newAssetId) return 0;
  const usageTable = args.tables.AssetUsage;
  const pagesTable = requireTable(args.tables.Pages, "PAGES_TABLE_NAME");
  const imageAssets = requireTable(args.tables.ImageAssets, "IMAGE_ASSETS_TABLE_NAME");
  const ownerId = requireCognitoSub(args.caller);

  // 소유자 검증 — 둘 다 같은 ownerId 여야 함
  const [oldRes, newRes] = await Promise.all([
    args.doc.send(new GetCommand({ TableName: imageAssets, Key: { id: oldAssetId } })),
    args.doc.send(new GetCommand({ TableName: imageAssets, Key: { id: newAssetId } })),
  ]);
  const oldAsset = oldRes.Item as { ownerId?: string } | undefined;
  const newAsset = newRes.Item as { ownerId?: string } | undefined;
  if (!oldAsset) throw notFound("oldAssetId 없음");
  if (!newAsset) throw notFound("newAssetId 없음");
  if (oldAsset.ownerId !== ownerId || newAsset.ownerId !== ownerId) {
    throw unauthorized("다른 사용자의 자산은 교체할 수 없습니다");
  }

  // 영향받는 페이지 id 수집
  const pageIds = new Set<string>();
  const pageWorkspaceMap = new Map<string, string>(); // pageId -> workspaceId (PK SK 동시 필요)
  if (usageTable) {
    let startKey: Record<string, unknown> | undefined = undefined;
    do {
      const res = await args.doc.send(
        new QueryCommand({
          TableName: usageTable,
          KeyConditionExpression: "assetId = :a",
          ExpressionAttributeValues: { ":a": oldAssetId },
          ProjectionExpression: "pageId, workspaceId",
          ExclusiveStartKey: startKey,
        }),
      );
      for (const it of (res.Items ?? []) as { pageId?: string; workspaceId?: string }[]) {
        if (it.pageId) {
          pageIds.add(it.pageId);
          if (it.workspaceId) pageWorkspaceMap.set(it.pageId, it.workspaceId);
        }
      }
      startKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (startKey);
  }

  // 각 페이지의 doc JSON 에서 ref 치환 후 저장 + AssetUsage 갱신
  let updated = 0;
  for (const pageId of pageIds) {
    const workspaceId = pageWorkspaceMap.get(pageId);
    if (!workspaceId) continue;
    const pageRes = await args.doc.send(
      new GetCommand({ TableName: pagesTable, Key: { id: pageId, workspaceId } }),
    );
    const page = pageRes.Item as
      | { id: string; workspaceId: string; doc?: string; title?: string; icon?: string | null; coverImage?: string | null; updatedAt: string }
      | undefined;
    if (!page) continue;
    const swap = (s: string | null | undefined): string | null | undefined => {
      if (!s || typeof s !== "string") return s;
      return s
        .split(`${IMAGE_SCHEME}${oldAssetId}`).join(`${IMAGE_SCHEME}${newAssetId}`)
        .split(`${FILE_SCHEME}${oldAssetId}`).join(`${FILE_SCHEME}${newAssetId}`);
    };
    const replacedDoc = swap(page.doc) as string | undefined;
    const replacedIcon = swap(page.icon ?? null);
    const replacedCover = swap(page.coverImage ?? null);
    const changed =
      replacedDoc !== page.doc ||
      replacedIcon !== (page.icon ?? null) ||
      replacedCover !== (page.coverImage ?? null);
    if (!changed) continue;
    const now = new Date().toISOString();
    await args.doc.send(
      new PutCommand({
        TableName: pagesTable,
        Item: {
          ...page,
          ...(replacedDoc !== undefined ? { doc: replacedDoc } : {}),
          icon: replacedIcon ?? null,
          coverImage: replacedCover ?? null,
          updatedAt: now,
        },
      }),
    );
    await syncPageAssetUsage({
      doc: args.doc,
      tables: args.tables,
      ownerId,
      workspaceId,
      pageId,
      pageTitle: page.title ?? null,
      pageDoc: replacedDoc ?? page.doc,
      pageIcon: replacedIcon ?? null,
      pageCoverImage: replacedCover ?? null,
    });
    updated += 1;
  }
  return updated;
}

// 증분 재인덱싱 체크포인트 — 마지막으로 완료한 재인덱싱의 시작 시각(ISO)을 소유자별로 보관.
// AssetUsage 테이블에 함께 저장하되 ownerId/pageId 속성을 넣지 않아 byOwner/byPage GSI 에
// 투영되지 않게 한다(usageCount 집계·byPage 삭제 쿼리 오염 방지). PK/SK 직접 read 로만 접근.
const REINDEX_CHECKPOINT_PK = "__reindex_checkpoint__";

async function readReindexCheckpoint(
  doc: DynamoDBDocumentClient,
  usageTable: string,
  ownerId: string,
): Promise<string | null> {
  try {
    const res = await doc.send(
      new GetCommand({ TableName: usageTable, Key: { assetId: REINDEX_CHECKPOINT_PK, sk: ownerId } }),
    );
    const v = res.Item?.lastReindexAt;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

async function writeReindexCheckpoint(
  doc: DynamoDBDocumentClient,
  usageTable: string,
  ownerId: string,
  iso: string,
): Promise<void> {
  await doc.send(
    new PutCommand({
      TableName: usageTable,
      Item: { assetId: REINDEX_CHECKPOINT_PK, sk: ownerId, lastReindexAt: iso },
    }),
  );
}

// 멀티콜 재인덱싱 상태 — cursor(base64 JSON)에 실어 호출 간 이어붙인다.
type ReindexCursorState = {
  key?: Record<string, unknown>; // DynamoDB LastEvaluatedKey
  since: string | null; // updatedAt 하한(증분). null 이면 전체 스캔.
  startedAt: string; // 이번 실행 시작 시각 — 완료 시 새 체크포인트로 기록.
};

/**
 * 기존 페이지를 스캔해 AssetUsage 인덱스를 재구성. 시간-박스 방식.
 * - cursor: 이전 호출의 nextCursor (base64-encoded 상태). 첫 호출은 null.
 * - incremental=true: 마지막 완료 체크포인트 이후 updatedAt 이 갱신된 페이지만 스캔한다.
 *   체크포인트가 없으면(최초 인덱싱) 전체 스캔으로 폴백하고, 완료 시 체크포인트를 남긴다.
 *   변경 페이지만 처리하므로 대규모 워크스페이스에서 "삭제 전 미사용 확인" 재인덱싱이 빨라진다.
 *   (페이지 삭제는 cascadeDeletePageAssetUsage 가 즉시 usage 를 정리하므로 유령 usage 는 안 남는다.)
 * - 호출당 약 22초 안에 가능한 만큼 처리하고, 남은 게 있으면 nextCursor 반환.
 * - 클라이언트는 hasMore=true 인 동안 cursor 를 그대로 전달해 반복 호출.
 */
export async function migrateAssetUsage(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: { memberId: string; cognitoSub?: string | null };
  cursor?: string | null;
  incremental?: boolean;
}): Promise<{ processedRows: number; nextCursor: string | null; hasMore: boolean; mode: string }> {
  const pagesTable = requireTable(args.tables.Pages, "PAGES_TABLE_NAME");
  const usageTable = args.tables.AssetUsage;
  if (!usageTable) throw new Error("AssetUsage 테이블 미설정");
  const ownerId = requireCognitoSub(args.caller);
  const deadline = Date.now() + 22 * 1000; // Lambda 28s, AppSync 30s 에 안전한 여유.

  // 커서 상태 해석. 유효한 startedAt 이 없으면 첫 호출로 보고 초기화한다.
  // (구버전/손상 커서도 첫 호출로 안전하게 재시작 — 재실행은 idempotent.)
  const decoded = decodeCursor(args.cursor ?? null) as Partial<ReindexCursorState> | undefined;
  let state: ReindexCursorState;
  if (decoded && typeof decoded.startedAt === "string") {
    state = { key: decoded.key, since: decoded.since ?? null, startedAt: decoded.startedAt };
  } else {
    const startedAt = new Date().toISOString();
    const since = args.incremental
      ? await readReindexCheckpoint(args.doc, usageTable, ownerId)
      : null;
    state = { key: undefined, since, startedAt };
  }
  const mode = state.since ? "incremental" : "full";

  let startKey = state.key;
  let totalRows = 0;
  while (true) {
    const scanInput: ScanCommandInput = {
      TableName: pagesTable,
      ExclusiveStartKey: startKey,
      Limit: 50,
    };
    if (state.since) {
      // 체크포인트 이후 갱신된 페이지만. updatedAt 속성이 없는(레거시) 페이지는 제외된다.
      scanInput.FilterExpression = "#u > :since";
      scanInput.ExpressionAttributeNames = { "#u": "updatedAt" };
      scanInput.ExpressionAttributeValues = { ":since": state.since };
    }
    const res = await args.doc.send(new ScanCommand(scanInput));
    const items = (res.Items ?? []) as Array<Record<string, unknown>>;
    // 한 페이지 안에서는 자산 소유 검증을 병렬화해 wall-clock 단축.
    for (const it of items) {
      const pageId = it.id as string | undefined;
      const workspaceId = it.workspaceId as string | undefined;
      const title = (it.title as string | undefined) ?? null;
      const docJson = it.doc as string | undefined;
      const iconStr = (it.icon as string | undefined) ?? null;
      const coverStr = (it.coverImage as string | undefined) ?? null;
      const dbCells = it.dbCells;
      if (!pageId || !workspaceId) continue;
      const refs = docJson ? extractAssetRefs(docJson) : [];
      for (const r of extractDbCellAssetRefs(dbCells)) refs.push(r);
      const iconAssetId = extractAssetIdFromString(iconStr);
      if (iconAssetId) refs.push({ assetId: iconAssetId, blockType: "pageIcon" });
      const coverAssetId = extractAssetIdFromString(coverStr);
      if (coverAssetId) refs.push({ assetId: coverAssetId, blockType: "pageCover" });
      if (refs.length === 0) continue;
      const ownershipFlags = await Promise.all(
        refs.map((ref) => isAssetOwnedBy(args.doc, args.tables, ref.assetId, ownerId)),
      );
      const ownedRefs = refs.filter((_, i) => ownershipFlags[i]);
      if (ownedRefs.length === 0) continue;
      await syncPageAssetUsage({
        doc: args.doc,
        tables: args.tables,
        ownerId,
        workspaceId,
        pageId,
        pageTitle: title,
        pageDoc: docJson ?? null,
        pageIcon: iconStr,
        pageCoverImage: coverStr,
        pageDbCells: dbCells,
      });
      totalRows += ownedRefs.length;
    }
    startKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    if (!startKey) {
      // 페이지 스캔이 끝났으면 CustomIcons 도 한 번 재인덱싱한다.
      // 라이브러리에만 등록되어 어떤 페이지에서도 쓰이지 않는 자산이 "미사용" 으로 잘못 분류돼 삭제되는 회귀 방지.
      try {
        const iconRows = await reindexCustomIconAssetUsage({
          doc: args.doc,
          tables: args.tables,
          ownerId,
        });
        totalRows += iconRows;
      } catch (err) {
        console.error("[migrateAssetUsage] CustomIcons 재인덱싱 실패 (무시)", err);
      }
      // 완료 — 다음 증분이 이어받도록 체크포인트를 이번 실행 시작시각으로 갱신한다.
      // (실행 중 갱신된 페이지는 since=startedAt 로 다음 증분에서 다시 잡혀 누락되지 않는다.)
      await writeReindexCheckpoint(args.doc, usageTable, ownerId, state.startedAt);
      return { processedRows: totalRows, nextCursor: null, hasMore: false, mode };
    }
    if (Date.now() >= deadline) {
      return {
        processedRows: totalRows,
        nextCursor: encodeCursor({ key: startKey, since: state.since, startedAt: state.startedAt }),
        hasMore: true,
        mode,
      };
    }
  }
}

// ===== CustomIcons 자산 사용 인덱싱 =====
function customIconSk(iconId: string): string {
  return `CUSTOM_ICON#${iconId}`;
}

/**
 * 워크스페이스 커스텀 아이콘 라이브러리에 등록된 자산 ref 를 AssetUsage 에 기록.
 * createCustomIcon 직후 호출.
 * src 가 quicknote-image:// / quicknote-file:// 가 아니면 skip.
 * 소유자 검증(ImageAssets.ownerId === caller cognitoSub) 후에만 기록한다.
 */
export async function syncCustomIconAssetUsage(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  ownerId: string;
  workspaceId: string;
  iconId: string;
  iconLabel?: string | null;
  src: string;
}): Promise<void> {
  const tableName = args.tables.AssetUsage;
  if (!tableName) return;
  const assetId = extractAssetIdFromString(args.src);
  if (!assetId) return; // 외부 URL / data URL 은 인덱싱 대상 아님
  const owned = await isAssetOwnedBy(args.doc, args.tables, assetId, args.ownerId);
  if (!owned) return; // 다른 사용자의 자산은 본인 인덱스에 넣지 않는다
  await args.doc.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        assetId,
        sk: customIconSk(args.iconId),
        ownerId: args.ownerId,
        pageId: `__customIcon__:${args.iconId}`,
        blockId: null,
        blockType: "customIcon",
        workspaceId: args.workspaceId,
        pageTitle: args.iconLabel ?? "워크스페이스 아이콘 라이브러리",
        iconId: args.iconId,
        updatedAt: new Date().toISOString(),
      },
    }),
  );
}

/** deleteCustomIcon 직후 호출 — 해당 iconId 의 사용 row 제거. assetId 는 src 에서 추출. */
export async function removeCustomIconAssetUsage(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  iconId: string;
  src: string;
}): Promise<void> {
  const tableName = args.tables.AssetUsage;
  if (!tableName) return;
  const assetId = extractAssetIdFromString(args.src);
  if (!assetId) return;
  await args.doc.send(
    new DeleteCommand({
      TableName: tableName,
      Key: { assetId, sk: customIconSk(args.iconId) },
    }),
  );
}

/**
 * CustomIcons 테이블 전체를 스캔해 caller 소유 자산을 가리키는 src 를 AssetUsage 에 재기록.
 * migrateAssetUsage 의 페이지 스캔 종료 직후 호출.
 */
async function reindexCustomIconAssetUsage(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  ownerId: string;
}): Promise<number> {
  const iconsTable = args.tables.CustomIcons;
  const usageTable = args.tables.AssetUsage;
  if (!iconsTable || !usageTable) return 0;
  let startKey: Record<string, unknown> | undefined = undefined;
  let total = 0;
  do {
    const res = await args.doc.send(
      new ScanCommand({
        TableName: iconsTable,
        ExclusiveStartKey: startKey,
        Limit: 100,
      }),
    );
    const items = (res.Items ?? []) as Array<{
      id?: string;
      workspaceId?: string;
      src?: string;
      label?: string;
    }>;
    for (const it of items) {
      if (!it.id || !it.workspaceId || !it.src) continue;
      const assetId = extractAssetIdFromString(it.src);
      if (!assetId) continue;
      const owned = await isAssetOwnedBy(args.doc, args.tables, assetId, args.ownerId);
      if (!owned) continue;
      try {
        await syncCustomIconAssetUsage({
          doc: args.doc,
          tables: args.tables,
          ownerId: args.ownerId,
          workspaceId: it.workspaceId,
          iconId: it.id,
          iconLabel: it.label ?? null,
          src: it.src,
        });
        total += 1;
      } catch (err) {
        console.error("[reindexCustomIconAssetUsage] put 실패", { iconId: it.id, err });
      }
    }
    startKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);
  return total;
}

function encodeCursor(key: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(key), "utf-8").toString("base64");
}

function decodeCursor(cursor: string | null): Record<string, unknown> | undefined {
  if (!cursor) return undefined;
  try {
    return JSON.parse(Buffer.from(cursor, "base64").toString("utf-8"));
  } catch {
    return undefined;
  }
}

const assetOwnerCache = new Map<string, string | null>();
async function isAssetOwnedBy(
  doc: DynamoDBDocumentClient,
  tables: Tables,
  assetId: string,
  ownerId: string,
): Promise<boolean> {
  if (assetOwnerCache.has(assetId)) return assetOwnerCache.get(assetId) === ownerId;
  const imageAssets = tables.ImageAssets;
  if (!imageAssets) return false;
  const res = await doc.send(new GetCommand({ TableName: imageAssets, Key: { id: assetId } }));
  const owner = (res.Item as { ownerId?: string } | undefined)?.ownerId ?? null;
  assetOwnerCache.set(assetId, owner);
  return owner === ownerId;
}
