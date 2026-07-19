// 공개 웹 게시 조회 Lambda — Function URL(authType NONE)로 인증 없이 노출된다.
// 보안 원칙:
//  - 유효한 token 이 곧 capability. 미존재/해제/삭제 등 인가성 실패는 균일한 404(존재 여부 오라클 차단).
//  - 페이지 조회는 "게시 루트의 자손 집합 소속 + workspaceId 일치"를 강제한다(IDOR 가드).
//  - 자산 응답은 해당 페이지 doc(+icon/coverImage)에 실제 참조된 assetId 만 허용한다.
//  - 응답 필드는 화이트리스트 — dbCells·blockComments·lastEditedBy* 등은 절대 내보내지 않는다.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { collectDocAssetIds } from "./docAssets";
import {
  collectSubtreeIds,
  loadPublishablePageMetas,
  type PublicPageMeta,
} from "./tree";
import {
  hasSharedBlockNodes,
  hydratePublicSharedBlocks,
} from "./sharedBlocks";
import {
  publicSnapshotPageKey,
  type PublicPageSnapshot,
  type PublicSiteSnapshot,
} from "./snapshot";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

const PUBLISHED_TABLE = process.env.PUBLISHED_PAGES_TABLE!;
const PAGES_TABLE = process.env.PAGES_TABLE!;
const SHARED_BLOCKS_TABLE = process.env.SHARED_BLOCKS_TABLE!;
const ASSET_TABLE = process.env.IMAGE_ASSET_TABLE!;
const ASSET_USAGE_TABLE = process.env.ASSET_USAGE_TABLE!;
const BUCKET = process.env.IMAGES_BUCKET!;

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const ID_RE = /^[A-Za-z0-9:._-]{1,128}$/;
// 짧은 CDN/브라우저 캐시 — 게시 해제 반영이 최대 이 시간만큼 지연되는 트레이드오프.
const CACHE_CONTROL = "public, max-age=30, s-maxage=300, stale-while-revalidate=300";
// 공개 자산은 권한 검증 후 Lambda가 바이트를 반환하고 CloudFront가 캐시한다.
// URL에 snapshotVersion(v)이 붙으므로 스냅샷 갱신 시 새 캐시 키로 전환된다.
const PUBLIC_ASSET_CACHE_CONTROL =
  "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";
// 워크스페이스 트리 계산 결과 컨테이너 내 메모(요청 폭주 완충).
const TREE_MEMO_TTL_MS = 30_000;
const PUBLISH_LINK_QUERY_CONCURRENCY = 8;

type FnUrlEvent = {
  requestContext?: { http?: { method?: string } };
  queryStringParameters?: Record<string, string | undefined>;
};

type FnUrlResult = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded?: boolean;
};

type PublishRecord = {
  token: string;
  pageId: string;
  workspaceId: string;
  revokedAt?: string | null;
  /** 게시 시점 루트 페이지 전체너비 스냅샷(레거시 호환·폴백용). */
  fullWidth?: boolean;
  /** 게시 시점 게시자 전역 전체너비 기본값. */
  fullWidthDefault?: boolean;
  /** 게시 시점 페이지별 전체너비 오버라이드 스냅샷(pageId → bool). */
  fullWidthById?: Record<string, boolean>;
  /** 공개 스냅샷 version. token은 유지하고 version만 교체한다. */
  snapshotVersion?: string | null;
  /** site.json S3 key. */
  snapshotSiteKey?: string | null;
  /** pages/{pageId}.json S3 key prefix. */
  snapshotPageKeyPrefix?: string | null;
  /** 스냅샷 생성 시각. */
  snapshotCreatedAt?: string | null;
  /** 스냅샷에 포함한 페이지 수. */
  snapshotPageCount?: number | null;
};

type PublicManifest = {
  token: string;
  rootId: string;
  snapshotVersion: string | null;
  snapshotCreatedAt: string | null;
  snapshotPageCount: number | null;
};

type PageRow = {
  id: string;
  workspaceId: string;
  title?: string;
  titleColor?: string | null;
  icon?: string | null;
  coverImage?: string | null;
  parentId?: string | null;
  order?: number;
  databaseId?: string | null;
  doc?: unknown;
  updatedAt?: string;
  deletedAt?: string | null;
};

const PAGE_PROJECTION =
  "id, workspaceId, title, titleColor, icon, coverImage, parentId, #order, databaseId, doc, updatedAt, deletedAt";

function baseHeaders(cacheControl: string): Record<string, string> {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": cacheControl,
    "x-robots-tag": "noindex, nofollow",
  };
}

function json(statusCode: number, body: unknown): FnUrlResult {
  // 성공(2xx)만 짧게 캐시. 에러(404/405/…)는 no-store —
  // 게시 직전에 받은 404 가 캐시돼 게시 후에도 계속 보이는 것을 막는다.
  const cache = statusCode >= 200 && statusCode < 300 ? CACHE_CONTROL : "no-store";
  return { statusCode, headers: baseHeaders(cache), body: JSON.stringify(body) };
}

function snapshotJson(body: unknown): FnUrlResult {
  return { statusCode: 200, headers: baseHeaders(CACHE_CONTROL), body: JSON.stringify(body) };
}

function manifestJson(body: PublicManifest): FnUrlResult {
  // CDN cache-busting 의 기준점이다. CloudFront·브라우저 모두 저장하지 않아야
  // 스냅샷 업데이트 직후 새 snapshotVersion 을 즉시 확인할 수 있다.
  return { statusCode: 200, headers: baseHeaders("no-store"), body: JSON.stringify(body) };
}

function notFound(): FnUrlResult {
  return json(404, { error: "not_found" });
}

async function bodyToString(body: unknown): Promise<string | null> {
  if (!body) return null;
  const maybe = body as { transformToString?: () => Promise<string> };
  if (typeof maybe.transformToString === "function") {
    return await maybe.transformToString();
  }
  return null;
}

async function bodyToBuffer(body: unknown): Promise<Buffer | null> {
  if (!body) return null;
  if (body instanceof Uint8Array) return Buffer.from(body);
  const maybe = body as {
    transformToByteArray?: () => Promise<Uint8Array>;
    transformToString?: () => Promise<string>;
    [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array | Buffer | string>;
  };
  if (typeof maybe.transformToByteArray === "function") {
    return Buffer.from(await maybe.transformToByteArray());
  }
  if (typeof maybe[Symbol.asyncIterator] === "function") {
    const chunks: Buffer[] = [];
    for await (const chunk of maybe as AsyncIterable<Uint8Array | Buffer | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  if (typeof maybe.transformToString === "function") {
    return Buffer.from(await maybe.transformToString());
  }
  return null;
}

async function readSnapshotJson<T>(key: string | null | undefined): Promise<T | null> {
  if (!key) return null;
  try {
    const result = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const text = await bodyToString(result.Body);
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch (error) {
    console.warn("[public-view] 공개 스냅샷 읽기 실패, live fallback 사용", {
      key,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function getSnapshotPageKey(
  publish: PublishRecord,
  pageId: string,
): string | null {
  if (!publish.snapshotVersion) return null;
  if (publish.snapshotPageKeyPrefix) {
    return `${publish.snapshotPageKeyPrefix}${pageId}.json`;
  }
  return publicSnapshotPageKey(publish.token, publish.snapshotVersion, pageId);
}

/** AWSJSON 이중 인코딩 가드 — 문자열이면 최대 2회 파싱한다. */
function parseDocField(value: unknown): unknown {
  let v = value;
  for (let i = 0; i < 2 && typeof v === "string"; i++) {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  return typeof v === "object" ? v : null;
}

async function getActivePublishRecord(token: string): Promise<PublishRecord | null> {
  const r = await ddb.send(
    new GetCommand({ TableName: PUBLISHED_TABLE, Key: { token } }),
  );
  const rec = r.Item as PublishRecord | undefined;
  if (!rec || rec.revokedAt) return null;
  return rec;
}

/**
 * 현재 트리 밖 드롭다운 대상 중 같은 워크스페이스에서 별도 게시 중인 루트의 href를 찾는다.
 * 대상 페이지의 존재·삭제·DB 행 여부는 이미 workspace 메타 쿼리의 공개 가능 집합으로 검증한다.
 */
async function resolvePublishedRootHrefs(
  pageIds: readonly string[],
  workspaceId: string,
  publishablePageIds: ReadonlySet<string>,
): Promise<ReadonlyMap<string, string>> {
  const ids = Array.from(new Set(pageIds)).filter(
    (pageId) => ID_RE.test(pageId) && publishablePageIds.has(pageId),
  );
  const hrefs = new Map<string, string>();
  for (let offset = 0; offset < ids.length; offset += PUBLISH_LINK_QUERY_CONCURRENCY) {
    const chunk = ids.slice(offset, offset + PUBLISH_LINK_QUERY_CONCURRENCY);
    const resolved = await Promise.all(chunk.map(async (pageId) => {
      try {
        const result = await ddb.send(
          new QueryCommand({
            TableName: PUBLISHED_TABLE,
            IndexName: "byPageId",
            KeyConditionExpression: "pageId = :p",
            ExpressionAttributeValues: { ":p": pageId },
            // token은 DynamoDB 예약어이므로 반드시 별칭을 사용한다.
            ProjectionExpression: "#token, pageId, workspaceId, revokedAt, publishedAt",
            ExpressionAttributeNames: { "#token": "token" },
            ScanIndexForward: false,
          }),
        );
        const record = (result.Items ?? [])
          .map((item) => item as PublishRecord)
          .find((item) =>
            item.pageId === pageId &&
            item.workspaceId === workspaceId &&
            !item.revokedAt &&
            TOKEN_RE.test(item.token)
          );
        return record ? ([pageId, `/p/${record.token}`] as const) : null;
      } catch (error) {
        console.warn("[public-view] 독립 게시 페이지 링크 조회 실패", {
          pageId,
          message: error instanceof Error ? error.message : String(error),
        });
        // 한 대상의 상태 조회 실패가 공개 페이지 전체를 깨지 않도록 fail-closed로 숨긴다.
        return null;
      }
    }));
    for (const entry of resolved) {
      if (entry) hrefs.set(entry[0], entry[1]);
    }
  }
  return hrefs;
}

/** 본문 포함 전체 행(op=page/op=asset 용). */
async function getPageRow(pageId: string): Promise<PageRow | null> {
  const r = await ddb.send(
    new GetCommand({
      TableName: PAGES_TABLE,
      Key: { id: pageId },
      ProjectionExpression: PAGE_PROJECTION,
      ExpressionAttributeNames: { "#order": "order" },
    }),
  );
  return (r.Item as PageRow | undefined) ?? null;
}

/** servable 게이트 전용 메타(doc 제외) — op=site·루트 검증에서 대용량 doc 을 읽지 않는다. */
async function getPageServableMeta(
  pageId: string,
): Promise<Pick<PageRow, "id" | "workspaceId" | "databaseId" | "deletedAt"> | null> {
  const r = await ddb.send(
    new GetCommand({
      TableName: PAGES_TABLE,
      Key: { id: pageId },
      ProjectionExpression: "id, workspaceId, databaseId, deletedAt",
    }),
  );
  return (
    (r.Item as
      | Pick<PageRow, "id" | "workspaceId" | "databaseId" | "deletedAt">
      | undefined) ?? null
  );
}

/** 게시 대상으로 유효한 페이지인지(존재·미삭제·워크스페이스 일치·DB 행 아님). */
function isServablePage<T extends Pick<PageRow, "workspaceId" | "databaseId" | "deletedAt">>(
  page: T | null,
  publish: PublishRecord,
): page is T {
  if (!page) return false;
  if (page.deletedAt) return false;
  if (page.workspaceId !== publish.workspaceId) return false;
  if (page.databaseId != null && page.databaseId !== "") return false;
  return true;
}

const treeMemo = new Map<
  string,
  { expiresAt: number; metas: Map<string, PublicPageMeta>; ids: Set<string> }
>();

async function getPublishedTree(publish: PublishRecord): Promise<{
  metas: Map<string, PublicPageMeta>;
  ids: Set<string>;
}> {
  const cached = treeMemo.get(publish.token);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const metas = await loadPublishablePageMetas(
    ddb,
    PAGES_TABLE,
    publish.workspaceId,
  );
  const ids = collectSubtreeIds(metas, publish.pageId);
  const entry = { expiresAt: Date.now() + TREE_MEMO_TTL_MS, metas, ids };
  treeMemo.set(publish.token, entry);
  // 메모 상한(LRU) — 만료 항목 우선 제거하되, 전부 미만료로 200개를 넘으면
  // 가장 오래된(삽입 순) 항목부터 제거해 무한 증가·OOM 을 막는다.
  const MEMO_MAX = 200;
  if (treeMemo.size > MEMO_MAX) {
    for (const [key, value] of treeMemo) {
      if (value.expiresAt <= Date.now()) treeMemo.delete(key);
    }
    while (treeMemo.size > MEMO_MAX) {
      const oldest = treeMemo.keys().next().value;
      if (oldest === undefined) break;
      treeMemo.delete(oldest);
    }
  }
  return entry;
}

async function handleSite(publish: PublishRecord): Promise<FnUrlResult> {
  const snapshot = await readSnapshotJson<PublicSiteSnapshot>(publish.snapshotSiteKey);
  if (snapshot) return snapshotJson(snapshot);
  const { metas, ids } = await getPublishedTree(publish);
  const pages = Array.from(ids)
    .map((id) => metas.get(id))
    .filter((m): m is PublicPageMeta => Boolean(m));
  return json(200, { rootId: publish.pageId, pages });
}

function handleManifest(publish: PublishRecord): FnUrlResult {
  return manifestJson({
    token: publish.token,
    rootId: publish.pageId,
    snapshotVersion: publish.snapshotVersion ?? null,
    snapshotCreatedAt: publish.snapshotCreatedAt ?? null,
    snapshotPageCount: publish.snapshotPageCount ?? null,
  });
}

async function handlePage(
  publish: PublishRecord,
  pageId: string,
): Promise<FnUrlResult> {
  const snapshot = await readSnapshotJson<PublicPageSnapshot>(
    getSnapshotPageKey(publish, pageId),
  );
  if (snapshot) return snapshotJson(snapshot);
  if (pageId !== publish.pageId) {
    const { ids } = await getPublishedTree(publish);
    if (!ids.has(pageId)) return notFound();
  }
  const page = await getPageRow(pageId);
  if (!isServablePage(page, publish)) return notFound();
  // 게시 레코드에 스냅샷된 레이아웃만 사용(Pages/clientPrefs 공개 조회 금지).
  // 각 페이지 고유 너비(fullWidthById) → 전역 기본값(fullWidthDefault) → 레거시 단일값(fullWidth) 순 폴백.
  // 레거시 토큰(신규 필드 없음)은 재게시 전까지 기존 동작(루트 값)을 유지한다.
  const fullWidth =
    publish.fullWidthById?.[page.id] ??
    publish.fullWidthDefault ??
    publish.fullWidth === true;
  let pageDoc = parseDocField(page.doc);
  if (hasSharedBlockNodes(pageDoc)) {
    const { ids, metas } = await getPublishedTree(publish);
    const publishablePageIds = new Set(metas.keys());
    pageDoc = await hydratePublicSharedBlocks({
      docClient: ddb,
      tableName: SHARED_BLOCKS_TABLE,
      workspaceId: publish.workspaceId,
      publishedPageIds: ids,
      pageDoc,
      resolvePublishedPageHrefs: (pageIds) =>
        resolvePublishedRootHrefs(
          pageIds,
          publish.workspaceId,
          publishablePageIds,
        ),
    });
  }
  return json(200, {
    id: page.id,
    title: page.title ?? "",
    titleColor: page.titleColor ?? null,
    icon: page.icon ?? null,
    coverImage: page.coverImage ?? null,
    parentId: page.parentId ?? null,
    updatedAt: page.updatedAt ?? null,
    fullWidth,
    doc: pageDoc,
  });
}

/** 자산이 해당 워크스페이스에서 실제 사용(AssetUsage)되는지 — 교차 워크스페이스 다운로드 차단. */
async function assetUsedInWorkspace(
  assetId: string,
  workspaceId: string,
): Promise<boolean> {
  const r = await ddb.send(
    new QueryCommand({
      TableName: ASSET_USAGE_TABLE,
      KeyConditionExpression: "assetId = :a",
      ExpressionAttributeValues: { ":a": assetId },
      ProjectionExpression: "workspaceId",
    }),
  );
  for (const item of r.Items ?? []) {
    if ((item as { workspaceId?: string }).workspaceId === workspaceId) return true;
  }
  return false;
}

async function handleAsset(
  publish: PublishRecord,
  pageId: string,
  assetId: string,
): Promise<FnUrlResult> {
  if (pageId !== publish.pageId) {
    const { ids } = await getPublishedTree(publish);
    if (!ids.has(pageId)) return notFound();
  }
  const page = await getPageRow(pageId);
  if (!isServablePage(page, publish)) return notFound();
  let pageDoc = parseDocField(page.doc);
  if (hasSharedBlockNodes(pageDoc)) {
    const { ids } = await getPublishedTree(publish);
    pageDoc = await hydratePublicSharedBlocks({
      docClient: ddb,
      tableName: SHARED_BLOCKS_TABLE,
      workspaceId: publish.workspaceId,
      publishedPageIds: ids,
      pageDoc,
    });
  }
  // 1차 방어: 페이지에 실제 참조된 자산만(임의 assetId 다운로드 금지).
  const refs = collectDocAssetIds(pageDoc, [
    page.icon,
    page.coverImage,
  ]);
  if (!refs.has(assetId)) return notFound();
  // 페이지 chrome(icon/cover) 은 Pages 행에 직접 붙어 있으므로 AssetUsage 누락이어도
  // 게시 워크스페이스 소속 페이지만 통과하면 허용한다(제목 아이콘 401/깨짐 방지).
  const chromeIds = collectDocAssetIds(null, [page.icon, page.coverImage]);
  const isPageChrome = chromeIds.has(assetId);
  if (!isPageChrome) {
    // 2차 방어(교차 워크스페이스 유출 차단): doc attrs 는 클라이언트가 임의로 쓸 수 있으므로
    // AssetUsage 로 게시 워크스페이스 소속을 확인한다.
    const belongsToWorkspace = await assetUsedInWorkspace(
      assetId,
      publish.workspaceId,
    );
    if (!belongsToWorkspace) return notFound();
  }
  const assetRow = await ddb.send(
    new GetCommand({ TableName: ASSET_TABLE, Key: { id: assetId } }),
  );
  const asset = assetRow.Item as
    | { status?: string; key?: string; mimeType?: string }
    | undefined;
  if (!asset || asset.status !== "READY" || !asset.key) return notFound();

  const object = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: asset.key }),
  );
  const body = await bodyToBuffer(object.Body);
  if (!body) return notFound();
  const contentType = object.ContentType ?? asset.mimeType ?? "application/octet-stream";
  const headers = {
    ...baseHeaders(PUBLIC_ASSET_CACHE_CONTROL),
    "content-type": contentType,
  };
  if (typeof object.ETag === "string") headers.etag = object.ETag;
  return {
    statusCode: 200,
    headers,
    body: body.toString("base64"),
    isBase64Encoded: true,
  };
}

export async function handler(event: FnUrlEvent): Promise<FnUrlResult> {
  try {
    const method = event.requestContext?.http?.method ?? "GET";
    if (method !== "GET") {
      return json(405, { error: "method_not_allowed" });
    }
    const qs = event.queryStringParameters ?? {};
    const op = qs.op;
    const token = qs.token ?? "";
    if (!TOKEN_RE.test(token)) return notFound();

    const publish = await getActivePublishRecord(token);
    if (!publish) return notFound();
    // 루트 자체가 삭제/이동 불능 상태면 사이트 전체가 404. (doc 없는 메타만 조회)
    const rootMeta = await getPageServableMeta(publish.pageId);
    if (!isServablePage(rootMeta, publish)) return notFound();

    if (op === "manifest") return handleManifest(publish);
    if (op === "site") return await handleSite(publish);
    if (op === "page") {
      const pageId = qs.pageId ?? "";
      if (!ID_RE.test(pageId)) return notFound();
      return await handlePage(publish, pageId);
    }
    if (op === "asset") {
      const pageId = qs.pageId ?? "";
      const assetId = qs.assetId ?? "";
      if (!ID_RE.test(pageId) || !ID_RE.test(assetId)) return notFound();
      return await handleAsset(publish, pageId, assetId);
    }
    return notFound();
  } catch (err) {
    console.error("public-view unexpected error", err);
    return json(500, { error: "internal" });
  }
}
