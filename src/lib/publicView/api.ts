// 공개 웹 게시(public-view Lambda Function URL) fetch 래퍼.
// 비로그인 경로 — appsyncClient 등 인증 스택을 절대 import 하지 않는다.

export type PublicPageMeta = {
  id: string;
  title: string;
  titleColor: string | null;
  icon: string | null;
  parentId: string | null;
  order: number;
  updatedAt: string | null;
};

export type PublicSite = {
  rootId: string;
  pages: PublicPageMeta[];
};

export type PublicPage = {
  id: string;
  title: string;
  titleColor: string | null;
  icon: string | null;
  coverImage: string | null;
  parentId: string | null;
  updatedAt: string | null;
  /** 게시 시점 전체너비 스냅샷(구 토큰은 undefined → false). */
  fullWidth?: boolean;
  doc: unknown;
};

// 모듈 로드 시점 고정을 피하고 매 호출 조회(테스트 stubEnv 대응).
function getPublicViewUrl(): string {
  return (import.meta.env.VITE_PUBLIC_VIEW_URL as string | undefined) ?? "";
}

export function isPublicViewConfigured(): boolean {
  return getPublicViewUrl().length > 0;
}

function endpoint(params: Record<string, string>): string {
  const url = new URL(getPublicViewUrl());
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/** 404(미게시/해제)를 null 로 돌려준다. 그 외 실패는 throw. */
async function fetchJson<T>(url: string): Promise<T | null> {
  // 공개 페이지는 재게시·레이아웃 변경 직후에도 최신 스냅샷을 봐야 하므로
  // 브라우저 fetch 캐시를 우회한다. 서버의 짧은 캐시는 외부 직접 호출 보호용으로 유지한다.
  const resp = await fetch(url, { method: "GET", cache: "no-store" });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`public-view 요청 실패: ${resp.status}`);
  return (await resp.json()) as T;
}

export async function fetchPublicSite(token: string): Promise<PublicSite | null> {
  return fetchJson<PublicSite>(endpoint({ op: "site", token }));
}

export async function fetchPublicPage(
  token: string,
  pageId: string,
): Promise<PublicPage | null> {
  return fetchJson<PublicPage>(endpoint({ op: "page", token, pageId }));
}

/** 자산(이미지·파일)의 공개 URL — Lambda 가 검증 후 S3 presign 으로 302 리다이렉트한다. */
export function buildPublicAssetUrl(
  token: string,
  pageId: string,
  assetId: string,
): string {
  return endpoint({ op: "asset", token, pageId, assetId });
}
