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
  PutCommand,
  DeleteCommand,
  GetCommand,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import type { Tables } from "./member";
import { badRequest, notFound, unauthorized } from "./_auth";

const s3 = new S3Client({});

// 자산 ref 스킴 ↔ assetId 변환.
const IMAGE_SCHEME = "quicknote-image://";
const FILE_SCHEME = "quicknote-file://";

export type AssetRef = { assetId: string; blockId?: string; blockType?: string };

/** 페이지 doc(JSON 문자열 또는 객체) 내부의 모든 자산 참조를 평탄화해 수집. */
export function extractAssetRefs(docJson: unknown): AssetRef[] {
  if (!docJson) return [];
  const root = typeof docJson === "string" ? safeJsonParse(docJson) : docJson;
  if (!root || typeof root !== "object") return [];
  const out: AssetRef[] = [];
  walk(root, out, null);
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
}): Promise<void> {
  const tableName = args.tables.AssetUsage;
  if (!tableName) return; // 테이블 미설정 환경에서는 silently skip (점진적 배포 대비)
  // 1) 기존 rows 삭제
  await deletePageAssetUsageRows(args.doc, tableName, args.pageId);
  // 2) 새 rows 추가 (자산 ref 가 있을 때만)
  //    doc 본문 + page.icon + page.coverImage 까지 모두 인덱싱해 커스텀 아이콘이
  //    "사용 안 됨" 으로 잘못 분류되는 회귀를 방지.
  const refs = extractAssetRefs(args.pageDoc);
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
    let usageStartKey: Record<string, unknown> | undefined = undefined;
    do {
      const res = await args.doc.send(
        new QueryCommand({
          TableName: usageTable,
          IndexName: "byOwner",
          KeyConditionExpression: "ownerId = :o",
          ExpressionAttributeValues: { ":o": ownerId },
          ProjectionExpression: "assetId",
          ExclusiveStartKey: usageStartKey,
        }),
      );
      for (const it of (res.Items ?? []) as { assetId?: string }[]) {
        if (it.assetId) usageCount.set(it.assetId, (usageCount.get(it.assetId) ?? 0) + 1);
      }
      usageStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (usageStartKey);
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
  const items = (res.Items ?? []) as Array<Record<string, unknown>>;
  // ownerId 본인 자산의 사용 위치만 반환 (cross-user 보호)
  return items.filter((it) => (it.ownerId as string | undefined) === ownerId);
}

// ===== Mutations =====

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

/**
 * 기존 페이지를 전부 스캔해 AssetUsage 인덱스를 재구성.
 * caller 의 모든 워크스페이스에 걸친 페이지를 대상으로 — caller 가 소유한 자산 ref 만 인덱싱.
 * 결과는 인덱싱된 (assetId, pageId) row 수.
 */
export async function migrateAssetUsage(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: { memberId: string; cognitoSub?: string | null };
}): Promise<number> {
  const pagesTable = requireTable(args.tables.Pages, "PAGES_TABLE_NAME");
  const usageTable = args.tables.AssetUsage;
  if (!usageTable) throw new Error("AssetUsage 테이블 미설정");
  const ownerId = requireCognitoSub(args.caller);
  // Scan Pages 전체. 페이지 수가 작은 단계에서만 사용.
  let startKey: Record<string, unknown> | undefined = undefined;
  let totalRows = 0;
  do {
    const res = await args.doc.send(
      new ScanCommand({
        TableName: pagesTable,
        ExclusiveStartKey: startKey,
      }),
    );
    const items = (res.Items ?? []) as Array<Record<string, unknown>>;
    for (const it of items) {
      const pageId = it.id as string | undefined;
      const workspaceId = it.workspaceId as string | undefined;
      const title = (it.title as string | undefined) ?? null;
      const docJson = it.doc as string | undefined;
      const iconStr = (it.icon as string | undefined) ?? null;
      const coverStr = (it.coverImage as string | undefined) ?? null;
      if (!pageId || !workspaceId) continue;
      // doc 본문 + icon + coverImage 에서 ref 추출 → 본인 소유 자산만 인덱싱.
      const refs = docJson ? extractAssetRefs(docJson) : [];
      const iconAssetId = extractAssetIdFromString(iconStr);
      if (iconAssetId) refs.push({ assetId: iconAssetId, blockType: "pageIcon" });
      const coverAssetId = extractAssetIdFromString(coverStr);
      if (coverAssetId) refs.push({ assetId: coverAssetId, blockType: "pageCover" });
      if (refs.length === 0) continue;
      const ownedRefs: typeof refs = [];
      for (const ref of refs) {
        const owned = await isAssetOwnedBy(args.doc, args.tables, ref.assetId, ownerId);
        if (owned) ownedRefs.push(ref);
      }
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
      });
      totalRows += ownedRefs.length;
    }
    startKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);
  return totalRows;
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
