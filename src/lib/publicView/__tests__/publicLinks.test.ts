import { describe, expect, it } from "vitest";
import { resolvePublicViewerLinkAction } from "../publicLinks";

const published = new Set(["root", "child-1"]);

describe("publicLinks", () => {
  it("공개 라우트 링크는 게시 트리 안 페이지 이동으로 해석한다", () => {
    expect(
      resolvePublicViewerLinkAction(
        "/p/tok-1234567890abcdef?page=child-1",
        published,
        { currentOrigin: "https://quick-note-khaki.vercel.app" },
      ),
    ).toEqual({ kind: "navigate", pageId: "child-1" });
  });

  it("QuickNote 내부 버튼 링크도 게시 트리 안이면 공개 뷰어 내부 이동으로 해석한다", () => {
    expect(
      resolvePublicViewerLinkAction(
        "https://quick-note-khaki.vercel.app/?page=child-1&blockId=b1",
        published,
        { currentOrigin: "https://quick-note-khaki.vercel.app" },
      ),
    ).toEqual({ kind: "navigate", pageId: "child-1" });
  });

  it("게시 트리 밖 QuickNote 내부 링크는 무시한다", () => {
    expect(
      resolvePublicViewerLinkAction(
        "quicknote://page/secret-1",
        published,
        { currentOrigin: "https://quick-note-khaki.vercel.app" },
      ),
    ).toBeNull();
  });

  it("별도 token의 공개 루트 링크는 같은 탭 이동으로 해석한다", () => {
    expect(
      resolvePublicViewerLinkAction(
        "/p/othertoken1234567890",
        published,
        { currentOrigin: "https://quick-note-khaki.vercel.app" },
      ),
    ).toEqual({
      kind: "navigatePublic",
      href: "/p/othertoken1234567890",
    });
  });

  it("다른 origin의 공개 경로 모양 URL은 일반 외부 링크로 유지한다", () => {
    expect(
      resolvePublicViewerLinkAction(
        "https://example.com/p/othertoken1234567890",
        published,
        { currentOrigin: "https://quick-note-khaki.vercel.app" },
      ),
    ).toEqual({
      kind: "open",
      href: "https://example.com/p/othertoken1234567890",
    });
  });

  it("형식이 잘못된 상대 공개 경로는 이동하지 않는다", () => {
    expect(
      resolvePublicViewerLinkAction(
        "/p/short",
        published,
        { currentOrigin: "https://quick-note-khaki.vercel.app" },
      ),
    ).toBeNull();
  });

  it("외부 웹 링크는 새 탭 열기 대상으로 정규화한다", () => {
    expect(resolvePublicViewerLinkAction("example.com/path", published)).toEqual({
      kind: "open",
      href: "https://example.com/path",
    });
  });

  it("QuickNote가 아닌 외부 URL의 page 쿼리는 내부 링크로 오인하지 않는다", () => {
    expect(
      resolvePublicViewerLinkAction("https://example.com/docs?page=child-1", published),
    ).toEqual({
      kind: "open",
      href: "https://example.com/docs?page=child-1",
    });
  });
});
