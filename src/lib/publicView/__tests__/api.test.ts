// 공개 뷰어 API 래퍼 — 공개 페이지 데이터 캐시 정책 검증.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchPublicPage, fetchPublicSite } from "../api";

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
});
