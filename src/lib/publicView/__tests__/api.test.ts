// 공개 뷰어 API 래퍼 — 공개 페이지 데이터 캐시 정책 검증.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPublicAssetUrl,
  fetchPublicManifest,
  fetchPublicPage,
  fetchPublicSite,
} from "../api";

describe("publicView api", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_PUBLIC_VIEW_URL", "https://public.example/view");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ rootId: "root-1", pages: [] }), {
          status: 200,
        })),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("site/page 요청은 서버 Cache-Control을 활용하도록 브라우저 기본 캐시 정책을 사용한다", async () => {
    await fetchPublicSite("token-1");
    await fetchPublicPage("token-1", "page-1");

    const calls = vi.mocked(fetch).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]?.[1]).toEqual({ method: "GET" });
    expect(calls[1]?.[1]).toEqual({ method: "GET" });
  });

  it("manifest 요청은 CDN cache-busting 기준점이라 브라우저 캐시를 우회한다", async () => {
    await fetchPublicManifest("token-1");

    const calls = vi.mocked(fetch).mock.calls;
    expect(calls).toHaveLength(1);
    const url = new URL(String(calls[0]?.[0]));
    expect(url.searchParams.get("op")).toBe("manifest");
    expect(url.searchParams.get("token")).toBe("token-1");
    expect(calls[0]?.[1]).toEqual({ method: "GET", cache: "no-store" });
  });

  it("snapshotVersion이 있으면 site/page 요청에 v query를 붙여 CDN 캐시 키를 교체한다", async () => {
    await fetchPublicSite("token-1", "snap-1");
    await fetchPublicPage("token-1", "page-1", "snap-1");

    const calls = vi.mocked(fetch).mock.calls;
    expect(calls).toHaveLength(2);
    const siteUrl = new URL(String(calls[0]?.[0]));
    const pageUrl = new URL(String(calls[1]?.[0]));
    expect(siteUrl.searchParams.get("v")).toBe("snap-1");
    expect(pageUrl.searchParams.get("v")).toBe("snap-1");
    expect(calls[0]?.[1]).toEqual({ method: "GET" });
    expect(calls[1]?.[1]).toEqual({ method: "GET" });
  });

  it("asset URL도 snapshotVersion을 v query로 포함해 이미지 CDN 캐시 키를 교체한다", () => {
    const url = new URL(buildPublicAssetUrl("token-1", "page-1", "asset-1", "snap-1"));

    expect(url.searchParams.get("op")).toBe("asset");
    expect(url.searchParams.get("token")).toBe("token-1");
    expect(url.searchParams.get("pageId")).toBe("page-1");
    expect(url.searchParams.get("assetId")).toBe("asset-1");
    expect(url.searchParams.get("cors")).toBe("1");
    expect(url.searchParams.get("v")).toBe("snap-1");
  });
});
