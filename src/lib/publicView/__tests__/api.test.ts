// 공개 뷰어 API 래퍼 — 공개 페이지 데이터 캐시 우회 검증.
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

  it("site/page 요청은 브라우저 fetch 캐시를 우회한다", async () => {
    await fetchPublicSite("token-1");
    await fetchPublicPage("token-1", "page-1");

    const calls = vi.mocked(fetch).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]?.[1]).toMatchObject({ method: "GET", cache: "no-store" });
    expect(calls[1]?.[1]).toMatchObject({ method: "GET", cache: "no-store" });
  });
});
