import { createElement } from "react";
import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { PublicBreadcrumbBar, buildPublicBreadcrumb } from "../PublicBreadcrumbBar";
import type { PublicSite, PublicPageMeta } from "../../../lib/publicView/api";

function meta(id: string, parentId: string | null, title = id): PublicPageMeta {
  return { id, title, titleColor: null, icon: null, parentId, order: 0, updatedAt: null };
}

function site(rootId: string, pages: PublicPageMeta[]): PublicSite {
  return { rootId, pages };
}

describe("buildPublicBreadcrumb", () => {
  it("루트→현재 페이지 경로를 순서대로 만든다", () => {
    const s = site("root", [meta("root", null), meta("a", "root"), meta("b", "a")]);
    expect(buildPublicBreadcrumb(s, "b").map((m) => m.id)).toEqual(["root", "a", "b"]);
  });

  it("현재가 루트면 루트 하나만 반환한다", () => {
    const s = site("root", [meta("root", null), meta("a", "root")]);
    expect(buildPublicBreadcrumb(s, "root").map((m) => m.id)).toEqual(["root"]);
  });

  it("루트의 상위(트리 밖 조상)는 경로에 포함하지 않는다", () => {
    // 게시 루트 자체가 워크스페이스 중간 페이지인 경우 — parentId 가 있어도 루트에서 멈춘다.
    const s = site("mid", [meta("mid", "outside"), meta("child", "mid")]);
    expect(buildPublicBreadcrumb(s, "child").map((m) => m.id)).toEqual(["mid", "child"]);
  });

  it("순환 parentId 데이터에서도 종료한다", () => {
    const s = site("root", [meta("a", "b"), meta("b", "a")]);
    const path = buildPublicBreadcrumb(s, "a");
    expect(path.length).toBeLessThanOrEqual(2); // 무한 루프 없이 종료
  });

  it("트리 메타에 없는 페이지는 도달 구간까지만 반환한다", () => {
    const s = site("root", [meta("root", null), meta("a", "missing")]);
    expect(buildPublicBreadcrumb(s, "a").map((m) => m.id)).toEqual(["a"]);
  });

  it("상단 헤더 내부 폭은 주입된 본문 폭 클래스를 사용한다", () => {
    const s = site("root", [meta("root", null)]);
    const renderBar = (contentClassName: string) =>
      createElement(PublicBreadcrumbBar, {
        site: s,
        currentPageId: "root",
        canGoBack: false,
        onBack: () => undefined,
        onNavigate: () => undefined,
        renderIcon: () => null,
        contentClassName,
      });

    const { container, rerender } = render(renderBar("max-w-none px-4"));
    expect(container.querySelector("nav > div")?.className).toContain(
      "max-w-none px-4",
    );

    rerender(renderBar("max-w-[784px]"));
    expect(container.querySelector("nav > div")?.className).toContain(
      "max-w-[784px]",
    );
  });

  it("공개 경로 헤더는 스크롤 중에도 상단에 고정된다", () => {
    const s = site("root", [meta("root", null)]);
    const { container } = render(
      createElement(PublicBreadcrumbBar, {
        site: s,
        currentPageId: "root",
        canGoBack: false,
        onBack: () => undefined,
        onNavigate: () => undefined,
        renderIcon: () => null,
      }),
    );

    expect(container.querySelector("nav")?.className).toContain("sticky top-0");
  });
});
