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
import {
  badRequest,
  notFound,
  requireWorkspaceAccess,
  type Member,
} from "./_auth";
import type { Tables } from "./member";

export type PublishRecord = {
  token: string;
  pageId: string;
  workspaceId: string;
  publishedByMemberId: string;
  publishedAt: string;
  revokedAt?: string | null;
  /** 게시 시점 게시자의 페이지 전체너비 스냅샷(공개 뷰어 레이아웃). */
  fullWidth?: boolean;
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
};

function requirePublishTable(tables: Tables): string {
  if (!tables.PublishedPages) badRequest("PublishedPages table 미설정");
  return tables.PublishedPages;
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

/** 게시자 clientPrefs 에서 해당 페이지 전체너비 여부를 스냅샷한다. */
function resolvePageFullWidth(caller: Member, pageId: string): boolean {
  const raw = caller.clientPrefs;
  if (raw == null || raw === "") return false;
  try {
    const str = typeof raw === "string" ? raw : JSON.stringify(raw);
    const o = JSON.parse(str) as {
      fullWidth?: unknown;
      pageFullWidthById?: Record<string, unknown>;
    };
    const byPage = o.pageFullWidthById?.[pageId];
    if (typeof byPage === "boolean") return byPage;
    return o.fullWidth === true;
  } catch {
    return false;
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
  const actives = await getActivePublishRecords(args.doc, tableName, args.pageId);
  const existing = actives[0];
  if (existing) return toStatus(args.pageId, page.workspaceId, existing);

  const record: PublishRecord = {
    // 128bit 무작위 토큰 — URL 이 곧 capability.
    token: randomBytes(16).toString("base64url"),
    pageId: args.pageId,
    workspaceId: page.workspaceId,
    publishedByMemberId: args.caller.memberId,
    publishedAt: new Date().toISOString(),
    fullWidth: resolvePageFullWidth(args.caller, args.pageId),
  };
  await args.doc.send(
    new PutCommand({
      TableName: tableName,
      Item: record,
      ConditionExpression: "attribute_not_exists(#t)",
      ExpressionAttributeNames: { "#t": "token" },
    }),
  );
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
