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

export type PublicManifest = {
  token: string;
  rootId: string;
  snapshotVersion: string | null;
  snapshotCreatedAt: string | null;
  snapshotPageCount: number | null;
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

type FetchJsonOptions = {
  /** manifest 는 CDN cache-busting 기준점이므로 브라우저 캐시도 우회한다. */
  cache?: RequestCache;
};

/** 404(미게시/해제)를 null 로 돌려준다. 그 외 실패는 throw. */
async function fetchJson<T>(
  url: string,
  options: FetchJsonOptions = {},
): Promise<T | null> {
  // 공개 페이지는 token 고정 + snapshot version 교체 구조를 사용한다.
  // 브라우저가 서버 Cache-Control(max-age/stale-while-revalidate)을 활용할 수 있게 둔다.
  const init: RequestInit = { method: "GET" };
  if (options.cache) init.cache = options.cache;
  const resp = await fetch(url, init);
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`public-view 요청 실패: ${resp.status}`);
  return (await resp.json()) as T;
}

export async function fetchPublicManifest(
  token: string,
): Promise<PublicManifest | null> {
  return fetchJson<PublicManifest>(endpoint({ op: "manifest", token }), {
    cache: "no-store",
  });
}

export async function fetchPublicSite(
  token: string,
  snapshotVersion?: string | null,
): Promise<PublicSite | null> {
  return fetchJson<PublicSite>(
    endpoint({
      op: "site",
      token,
      ...(snapshotVersion ? { v: snapshotVersion } : {}),
    }),
  );
}

export async function fetchPublicPage(
  token: string,
  pageId: string,
  snapshotVersion?: string | null,
): Promise<PublicPage | null> {
  return fetchJson<PublicPage>(
    endpoint({
      op: "page",
      token,
      pageId,
      ...(snapshotVersion ? { v: snapshotVersion } : {}),
    }),
  );
}

/** 자산(이미지·파일)의 공개 URL — Lambda 가 검증 후 CDN 캐시 가능한 binary 응답을 반환한다. */
export function buildPublicAssetUrl(
  token: string,
  pageId: string,
  assetId: string,
  snapshotVersion?: string | null,
): string {
  return endpoint({
    op: "asset",
    token,
    pageId,
    assetId,
    // 과거 no-cors 이미지 요청으로 저장된 CDN 캐시와 분리해 CORS 이미지 응답을 새로 받는다.
    cors: "1",
    ...(snapshotVersion ? { v: snapshotVersion } : {}),
  });
}
