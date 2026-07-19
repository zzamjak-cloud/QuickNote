// 페이지 웹 게시(publish to web) — published-pages 테이블(토큰 = capability) 관리.
// 공개(비로그인) 조회는 public-view Lambda(Function URL)가 담당하고,
// 여기서는 로그인 멤버의 게시/해제/상태 조회만 처리한다.

import { randomBytes } from "node:crypto";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  badRequest,
  notFound,
  requireWorkspaceAccess,
  type Member,
} from "./_auth";
import type { Tables } from "./member";
import {
  buildPublishedTreeSnapshot,
  buildPublicPageSnapshot,
  buildPublicSiteSnapshot,
  publicSnapshotPageKey,
  publicSnapshotPageKeyPrefix,
  publicSnapshotSiteKey,
} from "../../public-view/snapshot";

const s3 = new S3Client({});
const MAX_SNAPSHOT_PAGES_PER_PUBLISH = 200;

export type PublishRecord = {
  token: string;
  pageId: string;
  workspaceId: string;
  publishedByMemberId: string;
  publishedAt: string;
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

export type PagePublishStatusGql = {
  pageId: string;
  workspaceId: string;
  published: boolean;
  token: string | null;
  publishedAt: string | null;
};

type BaseArgs = {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  pageId: string;
  layout?: unknown;
};

function requirePublishTable(tables: Tables): string {
  if (!tables.PublishedPages) badRequest("PublishedPages table 미설정");
  return tables.PublishedPages;
}

function resolveSnapshotTables(tables: Tables): {
  bucket: string;
  pagesTable: string;
  publishedPagesTable: string;
  sharedBlocksTable: string;
} | null {
  if (
    !tables.ImagesBucketName ||
    !tables.Pages ||
    !tables.PublishedPages ||
    !tables.SharedBlocks
  ) {
    return null;
  }
  return {
    bucket: tables.ImagesBucketName,
    pagesTable: tables.Pages,
    publishedPagesTable: tables.PublishedPages,
    sharedBlocksTable: tables.SharedBlocks,
  };
}

type PageGateRow = {
  id: string;
  workspaceId: string;
  deletedAt?: string | null;
  databaseId?: string | null;
};

async function getPageRow(
  doc: DynamoDBDocumentClient,
  tables: Tables,
  pageId: string,
): Promise<PageGateRow | null> {
  if (!tables.Pages) badRequest("Pages table 미설정");
  const r = await doc.send(
    new GetCommand({
      TableName: tables.Pages,
      Key: { id: pageId },
      ProjectionExpression: "id, workspaceId, deletedAt, databaseId",
    }),
  );
  return (r.Item as PageGateRow | undefined) ?? null;
}

/** pageId 의 active(미해제) 게시 레코드 목록 — publishedAt 최신순. */
export async function getActivePublishRecords(
  doc: DynamoDBDocumentClient,
  tableName: string,
  pageId: string,
): Promise<PublishRecord[]> {
  const r = await doc.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: "byPageId",
      KeyConditionExpression: "pageId = :p",
      ExpressionAttributeValues: { ":p": pageId },
      ScanIndexForward: false,
    }),
  );
  return ((r.Items ?? []) as PublishRecord[]).filter((rec) => !rec.revokedAt);
}

function toStatus(
  pageId: string,
  workspaceId: string,
  record: PublishRecord | null,
): PagePublishStatusGql {
  return {
    pageId,
    workspaceId,
    published: record != null,
    token: record?.token ?? null,
    publishedAt: record?.publishedAt ?? null,
  };
}

/**
 * 게시자 clientPrefs 에서 전체너비 레이아웃 스냅샷을 파싱한다.
 * 페이지별 오버라이드 맵(pageFullWidthById)과 전역 기본값(fullWidth)을 모두 담아,
 * 게시 트리 내 각 페이지가 자기 너비 설정으로 공개 뷰어에 렌더되도록 한다.
 */
type PublishLayoutSnapshot = {
  fullWidth: boolean;
  fullWidthDefault: boolean;
  fullWidthById: Record<string, boolean>;
};

function sanitizeFullWidthById(raw: unknown): Record<string, boolean> {
  const fullWidthById: Record<string, boolean> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fullWidthById;
  let n = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== "boolean") continue;
    fullWidthById[k] = v;
    if (++n >= 10000) break; // DDB 아이템 크기 방어
  }
  return fullWidthById;
}

function withRootWidth(
  layout: PublishLayoutSnapshot,
  pageId: string,
): PublishLayoutSnapshot {
  return {
    ...layout,
    fullWidthById: {
      ...layout.fullWidthById,
      [pageId]: layout.fullWidth,
    },
  };
}

function parseLayoutPrefs(caller: Member, pageId: string): PublishLayoutSnapshot {
  const raw = caller.clientPrefs;
  if (raw == null || raw === "") {
    return withRootWidth(
      { fullWidth: false, fullWidthDefault: false, fullWidthById: {} },
      pageId,
    );
  }
  try {
    const str = typeof raw === "string" ? raw : JSON.stringify(raw);
    const o = JSON.parse(str) as {
      fullWidth?: unknown;
      pageFullWidthById?: Record<string, unknown>;
    };
    const fullWidthDefault = o.fullWidth === true;
    const fullWidthById = sanitizeFullWidthById(o.pageFullWidthById);
    return withRootWidth(
      {
        fullWidth: fullWidthById[pageId] ?? fullWidthDefault,
        fullWidthDefault,
        fullWidthById,
      },
      pageId,
    );
  } catch {
    return withRootWidth(
      { fullWidth: false, fullWidthDefault: false, fullWidthById: {} },
      pageId,
    );
  }
}

function parseLayoutOverride(raw: unknown, pageId: string): PublishLayoutSnapshot | null {
  if (raw == null || raw === "") return null;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      badRequest("publish layout 형식이 올바르지 않습니다");
    }
    const o = parsed as {
      fullWidth?: unknown;
      fullWidthDefault?: unknown;
      fullWidthById?: unknown;
    };
    if (typeof o.fullWidth !== "boolean") {
      badRequest("publish layout.fullWidth 값이 필요합니다");
    }
    const fullWidthDefault =
      typeof o.fullWidthDefault === "boolean" ? o.fullWidthDefault : o.fullWidth;
    return withRootWidth(
      {
        fullWidth: o.fullWidth,
        fullWidthDefault,
        fullWidthById: sanitizeFullWidthById(o.fullWidthById),
      },
      pageId,
    );
  } catch (err) {
    if (err instanceof Error && err.name === "ResolverError") throw err;
    const msg = err instanceof Error ? err.message : String(err);
    badRequest(`publish layout 파싱 실패 — ${msg}`);
  }
}

function makeSnapshotVersion(): string {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(6).toString("hex")}`;
}

async function putSnapshotJson(args: {
  bucket: string;
  key: string;
  body: unknown;
}): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: args.bucket,
      Key: args.key,
      Body: JSON.stringify(args.body),
      ContentType: "application/json; charset=utf-8",
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
}

async function refreshPublishedSnapshot(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  publish: PublishRecord;
}): Promise<void> {
  const snapshotTables = resolveSnapshotTables(args.tables);
  if (!snapshotTables) return;

  try {
    const version = makeSnapshotVersion();
    const tree = await buildPublishedTreeSnapshot({
      docClient: args.doc,
      tables: snapshotTables,
      publish: args.publish,
    });
    const site = buildPublicSiteSnapshot({ publish: args.publish, tree });
    const siteKey = publicSnapshotSiteKey(args.publish.token, version);
    const pageKeyPrefix = publicSnapshotPageKeyPrefix(args.publish.token, version);
    const snapshotPageIds = site.pages
      .map((page) => page.id)
      .slice(0, MAX_SNAPSHOT_PAGES_PER_PUBLISH);

    for (const pageId of snapshotPageIds) {
      const page = await buildPublicPageSnapshot({
        docClient: args.doc,
        tables: snapshotTables,
        publish: args.publish,
        tree,
        pageId,
      });
      if (!page) continue;
      await putSnapshotJson({
        bucket: snapshotTables.bucket,
        key: publicSnapshotPageKey(args.publish.token, version, pageId),
        body: page,
      });
    }
    await putSnapshotJson({
      bucket: snapshotTables.bucket,
      key: siteKey,
      body: site,
    });

    await args.doc.send(
      new UpdateCommand({
        TableName: snapshotTables.publishedPagesTable,
        Key: { token: args.publish.token },
        UpdateExpression:
          "SET snapshotVersion = :v, snapshotSiteKey = :sk, snapshotPageKeyPrefix = :pkp, snapshotCreatedAt = :ca, snapshotPageCount = :pc",
        ConditionExpression: "pageId = :p",
        ExpressionAttributeValues: {
          ":v": version,
          ":sk": siteKey,
          ":pkp": pageKeyPrefix,
          ":ca": new Date().toISOString(),
          ":pc": snapshotPageIds.length,
          ":p": args.publish.pageId,
        },
      }),
    );
  } catch (error) {
    console.warn("[publish] 공개 스냅샷 생성 실패, live fallback 유지", {
      pageId: args.publish.pageId,
      token: args.publish.token,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** 페이지(+자손) 웹 게시. 이미 게시돼 있으면 기존 토큰 반환(멱등). */
export async function publishPage(args: BaseArgs): Promise<PagePublishStatusGql> {
  const tableName = requirePublishTable(args.tables);
  const page = await getPageRow(args.doc, args.tables, args.pageId);
  if (!page || page.deletedAt) notFound("페이지 없음");
  // DB 행 페이지는 공개 뷰어(public-view)가 서빙하지 않으므로 게시 자체를 거부한다
  // (게시 성공했으나 항상 404 인 유령 토큰 방지).
  if (page.databaseId != null && page.databaseId !== "") {
    badRequest("데이터베이스 행 페이지는 웹에 게시할 수 없습니다");
  }
  // 인자를 신뢰하지 않고 페이지의 실제 workspaceId 로 권한 검사(IDOR 가드).
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: page.workspaceId,
    required: "edit",
  });
  const layout = parseLayoutOverride(args.layout, args.pageId) ?? parseLayoutPrefs(args.caller, args.pageId);
  const actives = await getActivePublishRecords(args.doc, tableName, args.pageId);
  const existing = actives[0];
  if (existing) {
    // 멱등 재게시: 토큰·게시 시각은 유지하되 레이아웃(전체너비) 스냅샷만 현재 게시자
    // 설정으로 갱신한다. 게시 후 자식 페이지 너비를 바꾸거나 새 자식을 추가해도 공개
    // 뷰어가 최신 너비로 렌더되도록 하는 유일한 경로(재게시=새 토큰을 피하며 링크 유지).
    await args.doc.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { token: existing.token },
        UpdateExpression:
          "SET fullWidth = :fw, fullWidthDefault = :fwd, fullWidthById = :fwm",
        // 교차 페이지 변조 방지(unpublish 와 동일 가드).
        ConditionExpression: "pageId = :p",
        ExpressionAttributeValues: {
          ":fw": layout.fullWidth,
          ":fwd": layout.fullWidthDefault,
          ":fwm": layout.fullWidthById,
          ":p": args.pageId,
        },
      }),
    );
    await refreshPublishedSnapshot({
      doc: args.doc,
      tables: args.tables,
      publish: {
        ...existing,
        fullWidth: layout.fullWidth,
        fullWidthDefault: layout.fullWidthDefault,
        fullWidthById: layout.fullWidthById,
      },
    });
    return toStatus(args.pageId, page.workspaceId, existing);
  }

  const record: PublishRecord = {
    // 128bit 무작위 토큰 — URL 이 곧 capability.
    token: randomBytes(16).toString("base64url"),
    pageId: args.pageId,
    workspaceId: page.workspaceId,
    publishedByMemberId: args.caller.memberId,
    publishedAt: new Date().toISOString(),
    // 레거시 호환: 루트 페이지의 확정 너비.
    fullWidth: layout.fullWidth,
    // 자손 포함 각 페이지가 자기 너비로 렌더되도록 맵·전역 기본값을 함께 스냅샷.
    fullWidthDefault: layout.fullWidthDefault,
    fullWidthById: layout.fullWidthById,
  };
  await args.doc.send(
    new PutCommand({
      TableName: tableName,
      Item: record,
      ConditionExpression: "attribute_not_exists(#t)",
      ExpressionAttributeNames: { "#t": "token" },
    }),
  );
  await refreshPublishedSnapshot({ doc: args.doc, tables: args.tables, publish: record });
  return toStatus(args.pageId, page.workspaceId, record);
}

/** 웹 게시 해제 — 해당 페이지의 모든 active 토큰을 revoke(재게시 시 새 토큰). */
export async function unpublishPage(args: BaseArgs): Promise<PagePublishStatusGql> {
  const tableName = requirePublishTable(args.tables);
  const actives = await getActivePublishRecords(args.doc, tableName, args.pageId);
  const page = await getPageRow(args.doc, args.tables, args.pageId);
  // 페이지가 하드삭제됐어도 해제는 가능해야 한다 — 게시 레코드의 workspaceId 로 폴백.
  const workspaceId = page?.workspaceId ?? actives[0]?.workspaceId;
  if (!workspaceId) notFound("게시 정보 없음");
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId,
    required: "edit",
  });
  const now = new Date().toISOString();
  for (const rec of actives) {
    await args.doc.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { token: rec.token },
        UpdateExpression: "SET revokedAt = :r",
        // 교차 페이지 변조 방지 — 레코드의 pageId 일치 조건 가드.
        ConditionExpression: "pageId = :p",
        ExpressionAttributeValues: { ":r": now, ":p": args.pageId },
      }),
    );
  }
  return toStatus(args.pageId, workspaceId, null);
}

/** 게시 상태 조회 — 워크스페이스 view 권한 필요. */
export async function getPagePublishStatus(
  args: BaseArgs,
): Promise<PagePublishStatusGql> {
  const tableName = requirePublishTable(args.tables);
  const page = await getPageRow(args.doc, args.tables, args.pageId);
  if (!page) notFound("페이지 없음");
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: page.workspaceId,
    required: "view",
  });
  const actives = await getActivePublishRecords(args.doc, tableName, args.pageId);
  return toStatus(args.pageId, page.workspaceId, actives[0] ?? null);
}
