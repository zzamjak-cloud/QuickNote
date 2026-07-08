// 공개 웹 게시 조회 Lambda — Function URL(authType NONE)로 인증 없이 노출된다.
// 보안 원칙:
//  - 유효한 token 이 곧 capability. 미존재/해제/삭제 등 인가성 실패는 균일한 404(존재 여부 오라클 차단).
//  - 페이지 조회는 "게시 루트의 자손 집합 소속 + workspaceId 일치"를 강제한다(IDOR 가드).
//  - 자산 presign 은 해당 페이지 doc(+icon/coverImage)에 실제 참조된 assetId 만 허용한다.
//  - 응답 필드는 화이트리스트 — dbCells·blockComments·lastEditedBy* 등은 절대 내보내지 않는다.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { collectDocAssetIds } from "./docAssets";
import {
  collectSubtreeIds,
  loadPublishablePageMetas,
  type PublicPageMeta,
} from "./tree";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

const PUBLISHED_TABLE = process.env.PUBLISHED_PAGES_TABLE!;
const PAGES_TABLE = process.env.PAGES_TABLE!;
const ASSET_TABLE = process.env.IMAGE_ASSET_TABLE!;
const BUCKET = process.env.IMAGES_BUCKET!;

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const ID_RE = /^[A-Za-z0-9:._-]{1,128}$/;
const ASSET_PRESIGN_TTL_SECONDS = 300;
// 짧은 CDN/브라우저 캐시 — 게시 해제 반영이 최대 이 시간만큼 지연되는 트레이드오프.
const CACHE_CONTROL = "public, max-age=60";
// 워크스페이스 트리 계산 결과 컨테이너 내 메모(요청 폭주 완충).
const TREE_MEMO_TTL_MS = 30_000;

type FnUrlEvent = {
  requestContext?: { http?: { method?: string } };
  queryStringParameters?: Record<string, string | undefined>;
};

type FnUrlResult = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

type PublishRecord = {
  token: string;
  pageId: string;
  workspaceId: string;
  revokedAt?: string | null;
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

function baseHeaders(): Record<string, string> {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": CACHE_CONTROL,
    "x-robots-tag": "noindex, nofollow",
  };
}

function json(statusCode: number, body: unknown): FnUrlResult {
  return { statusCode, headers: baseHeaders(), body: JSON.stringify(body) };
}

function notFound(): FnUrlResult {
  return json(404, { error: "not_found" });
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

/** 게시 대상으로 유효한 페이지인지(존재·미삭제·워크스페이스 일치·DB 행 아님). */
function isServablePage(page: PageRow | null, publish: PublishRecord): page is PageRow {
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
  // 메모 누수 방지 — 오래된 항목 정리
  if (treeMemo.size > 200) {
    for (const [key, value] of treeMemo) {
      if (value.expiresAt <= Date.now()) treeMemo.delete(key);
    }
  }
  return entry;
}

async function handleSite(publish: PublishRecord): Promise<FnUrlResult> {
  const { metas, ids } = await getPublishedTree(publish);
  const pages = Array.from(ids)
    .map((id) => metas.get(id))
    .filter((m): m is PublicPageMeta => Boolean(m));
  return json(200, { rootId: publish.pageId, pages });
}

async function handlePage(
  publish: PublishRecord,
  pageId: string,
): Promise<FnUrlResult> {
  if (pageId !== publish.pageId) {
    const { ids } = await getPublishedTree(publish);
    if (!ids.has(pageId)) return notFound();
  }
  const page = await getPageRow(pageId);
  if (!isServablePage(page, publish)) return notFound();
  return json(200, {
    id: page.id,
    title: page.title ?? "",
    titleColor: page.titleColor ?? null,
    icon: page.icon ?? null,
    coverImage: page.coverImage ?? null,
    parentId: page.parentId ?? null,
    updatedAt: page.updatedAt ?? null,
    doc: parseDocField(page.doc),
  });
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
  // 페이지에 실제 참조된 자산만 presign(임의 assetId presign 금지).
  const refs = collectDocAssetIds(parseDocField(page.doc), [
    page.icon,
    page.coverImage,
  ]);
  if (!refs.has(assetId)) return notFound();
  const assetRow = await ddb.send(
    new GetCommand({ TableName: ASSET_TABLE, Key: { id: assetId } }),
  );
  const asset = assetRow.Item as
    | { status?: string; key?: string }
    | undefined;
  if (!asset || asset.status !== "READY" || !asset.key) return notFound();
  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: BUCKET, Key: asset.key }),
    { expiresIn: ASSET_PRESIGN_TTL_SECONDS },
  );
  return {
    statusCode: 302,
    headers: { ...baseHeaders(), location: url },
    body: "",
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
    // 루트 자체가 삭제/이동 불능 상태면 사이트 전체가 404.
    const root = await getPageRow(publish.pageId);
    if (!isServablePage(root, publish)) return notFound();

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
