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

export type PublishPageLayoutSnapshot = {
  fullWidth: boolean;
  fullWidthDefault: boolean;
  fullWidthById: Record<string, boolean>;
};

type GqlEnvelope = {
  data?: Record<string, PagePublishStatus | undefined>;
  errors?: Array<{ message?: string }>;
};

async function callPublishField(
  query: string,
  fieldName: string,
  variables: { pageId: string; layout?: string },
): Promise<PagePublishStatus> {
  const result = (await appsyncClient().graphql({
    query,
    variables,
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
  return callPublishField(GET_PAGE_PUBLISH_STATUS, "getPagePublishStatus", {
    pageId,
  });
}

export async function publishPageApi(
  pageId: string,
  layout?: PublishPageLayoutSnapshot,
): Promise<PagePublishStatus> {
  return callPublishField(PUBLISH_PAGE, "publishPage", {
    pageId,
    ...(layout ? { layout: JSON.stringify(layout) } : {}),
  });
}

export async function unpublishPageApi(pageId: string): Promise<PagePublishStatus> {
  return callPublishField(UNPUBLISH_PAGE, "unpublishPage", { pageId });
}

const DEFAULT_PUBLIC_WEB_ORIGIN = "https://quick-note-khaki.vercel.app";

/**
 * 공개 뷰어 URL — /p/<token>.
 * 웹 배포(preview/production)에서는 **현재 origin** 을 쓴다.
 * 게시 토큰은 현재 AppSync/DDB 환경에만 있으므로 khaki 로 강제하면
 * develop 게시 → prod Lambda 조회 404 가 난다.
 * 로컬·데스크톱만 VITE_WEB_APP_ORIGIN(또는 khaki) 폴백.
 */
export function buildPublicPageUrl(token: string): string {
  const configured = (
    import.meta.env.VITE_WEB_APP_ORIGIN as string | undefined
  )?.replace(/\/+$/, "");
  let origin = configured || DEFAULT_PUBLIC_WEB_ORIGIN;
  if (typeof window !== "undefined") {
    const loc = window.location.origin;
    const host = window.location.hostname;
    const isLocal = host === "localhost" || host === "127.0.0.1";
    const isTauri =
      loc.startsWith("tauri:") ||
      host === "tauri.localhost" ||
      host.endsWith(".tauri.localhost");
    if (
      !isLocal &&
      !isTauri &&
      (loc.startsWith("http://") || loc.startsWith("https://"))
    ) {
      origin = loc;
    }
  }
  return `${origin}/p/${token}`;
}
