// 페이지 웹 게시 API 래퍼 — 게시/해제/상태 조회(로그인 멤버 전용).

import { appsyncClient } from "./graphql/client";
import {
  GET_PAGE_PUBLISH_STATUS,
  PUBLISH_PAGE,
  UNPUBLISH_PAGE,
} from "./queries/publish";

export type PagePublishStatus = {
  pageId: string;
  workspaceId: string;
  published: boolean;
  token: string | null;
  publishedAt: string | null;
};

type GqlEnvelope = {
  data?: Record<string, PagePublishStatus | undefined>;
  errors?: Array<{ message?: string }>;
};

async function callPublishField(
  query: string,
  fieldName: string,
  pageId: string,
): Promise<PagePublishStatus> {
  const result = (await appsyncClient().graphql({
    query,
    variables: { pageId },
  })) as GqlEnvelope;
  const message = result.errors?.[0]?.message;
  if (message) throw new Error(message);
  const status = result.data?.[fieldName];
  if (!status) throw new Error(`${fieldName} 응답 없음`);
  return status;
}

export async function getPagePublishStatusApi(
  pageId: string,
): Promise<PagePublishStatus> {
  return callPublishField(GET_PAGE_PUBLISH_STATUS, "getPagePublishStatus", pageId);
}

export async function publishPageApi(pageId: string): Promise<PagePublishStatus> {
  return callPublishField(PUBLISH_PAGE, "publishPage", pageId);
}

export async function unpublishPageApi(pageId: string): Promise<PagePublishStatus> {
  return callPublishField(UNPUBLISH_PAGE, "unpublishPage", pageId);
}

/** 공개 뷰어 URL — 웹 도메인 기준(/p/<token>). */
export function buildPublicPageUrl(token: string): string {
  return `${window.location.origin}/p/${token}`;
}
