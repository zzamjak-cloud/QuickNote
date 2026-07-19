// 공개 게시 스냅샷 생성 공용 유틸.
// 편집용 Pages/SharedBlock 레코드를 방문자 요청마다 조립하지 않도록,
// 게시/스냅샷 갱신 시점에 공개 응답 payload를 미리 만든다.

import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  collectSubtreeIds,
  loadPublishablePageMetas,
  type PublicPageMeta,
} from "./tree";
import {
  hasSharedBlockNodes,
  hydratePublicSharedBlocks,
} from "./sharedBlocks";

const ID_RE = /^[A-Za-z0-9:._-]{1,128}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const PUBLISH_LINK_QUERY_CONCURRENCY = 8;

const PAGE_PROJECTION =
  "id, workspaceId, title, titleColor, icon, coverImage, parentId, #order, databaseId, doc, updatedAt, deletedAt";

export const PUBLIC_SNAPSHOT_PREFIX = "public-snapshots";

export type PublicSnapshotPublishRecord = {
  token: string;
  pageId: string;
  workspaceId: string;
  revokedAt?: string | null;
  fullWidth?: boolean;
  fullWidthDefault?: boolean;
  fullWidthById?: Record<string, boolean>;
  snapshotVersion?: string | null;
  snapshotSiteKey?: string | null;
  snapshotPageKeyPrefix?: string | null;
  snapshotCreatedAt?: string | null;
  snapshotPageCount?: number | null;
};

export type PublicSnapshotTables = {
  pagesTable: string;
  publishedPagesTable: string;
  sharedBlocksTable: string;
};

export type PublicSiteSnapshot = {
  rootId: string;
  pages: PublicPageMeta[];
};

export type PublicPageSnapshot = {
  id: string;
  title: string;
  titleColor: string | null;
  icon: string | null;
  coverImage: string | null;
  parentId: string | null;
  updatedAt: string | null;
  fullWidth: boolean;
  doc: unknown;
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

type PublishedTree = {
  metas: Map<string, PublicPageMeta>;
  ids: Set<string>;
};

export function publicSnapshotSiteKey(token: string, version: string): string {
  return `${PUBLIC_SNAPSHOT_PREFIX}/${token}/${version}/site.json`;
}

export function publicSnapshotPageKey(
  token: string,
  version: string,
  pageId: string,
): string {
  return `${PUBLIC_SNAPSHOT_PREFIX}/${token}/${version}/pages/${pageId}.json`;
}

export function publicSnapshotPageKeyPrefix(
  token: string,
  version: string,
): string {
  return `${PUBLIC_SNAPSHOT_PREFIX}/${token}/${version}/pages/`;
}

function parseDocField(raw: unknown): unknown {
  if (typeof raw !== "string") return raw ?? null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isServablePage(
  page: PageRow | null,
  publish: PublicSnapshotPublishRecord,
): page is PageRow {
  return Boolean(
    page &&
      page.workspaceId === publish.workspaceId &&
      !page.deletedAt &&
      (page.databaseId == null || page.databaseId === ""),
  );
}

function resolveFullWidth(
  publish: PublicSnapshotPublishRecord,
  pageId: string,
): boolean {
  return (
    publish.fullWidthById?.[pageId] ??
    publish.fullWidthDefault ??
    publish.fullWidth === true
  );
}

async function getPageRow(
  docClient: DynamoDBDocumentClient,
  pagesTable: string,
  pageId: string,
): Promise<PageRow | null> {
  const r = await docClient.send(
    new GetCommand({
      TableName: pagesTable,
      Key: { id: pageId },
      ProjectionExpression: PAGE_PROJECTION,
      ExpressionAttributeNames: { "#order": "order" },
    }),
  );
  return (r.Item as PageRow | undefined) ?? null;
}

async function resolvePublishedRootHrefs(
  docClient: DynamoDBDocumentClient,
  publishedPagesTable: string,
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
        const result = await docClient.send(
          new QueryCommand({
            TableName: publishedPagesTable,
            IndexName: "byPageId",
            KeyConditionExpression: "pageId = :p",
            ExpressionAttributeValues: { ":p": pageId },
            ProjectionExpression: "#token, pageId, workspaceId, revokedAt, publishedAt",
            ExpressionAttributeNames: { "#token": "token" },
            ScanIndexForward: false,
          }),
        );
        const record = (result.Items ?? [])
          .map((item) => item as PublicSnapshotPublishRecord)
          .find((item) =>
            item.pageId === pageId &&
            item.workspaceId === workspaceId &&
            !item.revokedAt &&
            TOKEN_RE.test(item.token)
          );
        return record ? ([pageId, `/p/${record.token}`] as const) : null;
      } catch (error) {
        console.warn("[public-snapshot] 독립 게시 페이지 링크 조회 실패", {
          pageId,
          message: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    }));
    for (const entry of resolved) {
      if (entry) hrefs.set(entry[0], entry[1]);
    }
  }
  return hrefs;
}

export async function buildPublishedTreeSnapshot(args: {
  docClient: DynamoDBDocumentClient;
  tables: PublicSnapshotTables;
  publish: PublicSnapshotPublishRecord;
}): Promise<PublishedTree> {
  const metas = await loadPublishablePageMetas(
    args.docClient,
    args.tables.pagesTable,
    args.publish.workspaceId,
  );
  return { metas, ids: collectSubtreeIds(metas, args.publish.pageId) };
}

export function buildPublicSiteSnapshot(args: {
  publish: PublicSnapshotPublishRecord;
  tree: PublishedTree;
}): PublicSiteSnapshot {
  const pages = Array.from(args.tree.ids)
    .map((id) => args.tree.metas.get(id))
    .filter((m): m is PublicPageMeta => Boolean(m));
  return { rootId: args.publish.pageId, pages };
}

export async function buildPublicPageSnapshot(args: {
  docClient: DynamoDBDocumentClient;
  tables: PublicSnapshotTables;
  publish: PublicSnapshotPublishRecord;
  tree: PublishedTree;
  pageId: string;
}): Promise<PublicPageSnapshot | null> {
  if (args.pageId !== args.publish.pageId && !args.tree.ids.has(args.pageId)) {
    return null;
  }
  const page = await getPageRow(
    args.docClient,
    args.tables.pagesTable,
    args.pageId,
  );
  if (!isServablePage(page, args.publish)) return null;

  let pageDoc = parseDocField(page.doc);
  if (hasSharedBlockNodes(pageDoc)) {
    const publishablePageIds = new Set(args.tree.metas.keys());
    pageDoc = await hydratePublicSharedBlocks({
      docClient: args.docClient,
      tableName: args.tables.sharedBlocksTable,
      workspaceId: args.publish.workspaceId,
      publishedPageIds: args.tree.ids,
      pageDoc,
      resolvePublishedPageHrefs: (pageIds) =>
        resolvePublishedRootHrefs(
          args.docClient,
          args.tables.publishedPagesTable,
          pageIds,
          args.publish.workspaceId,
          publishablePageIds,
        ),
    });
  }

  return {
    id: page.id,
    title: page.title ?? "",
    titleColor: page.titleColor ?? null,
    icon: page.icon ?? null,
    coverImage: page.coverImage ?? null,
    parentId: page.parentId ?? null,
    updatedAt: page.updatedAt ?? null,
    fullWidth: resolveFullWidth(args.publish, page.id),
    doc: pageDoc,
  };
}
