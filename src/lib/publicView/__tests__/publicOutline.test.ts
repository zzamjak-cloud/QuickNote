import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findPublicOutlineTargets,
  scrollPublicOutlineTargetIntoView,
} from "../publicOutline";

describe("publicOutline", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("공개 뷰어 DOM에서 헤딩과 제목 토글만 문서 순서대로 찾는다", () => {
    document.body.innerHTML = `
      <div class="qn-public-doc">
        <div class="ProseMirror">
          <h1>첫 제목</h1>
          <summary class="toggle-header" data-title-level="2">제목 토글</summary>
          <h5>목차 제외</h5>
          <summary class="toggle-header">일반 토글</summary>
          <h3>세 번째 제목</h3>
        </div>
      </div>
    `;

    expect(findPublicOutlineTargets().map((el) => el.textContent)).toEqual([
      "첫 제목",
      "제목 토글",
      "세 번째 제목",
    ]);
  });

  it("목차 인덱스에 해당하는 공개 뷰어 DOM 위치로 스크롤한다", () => {
    document.body.innerHTML = `
      <div class="qn-public-doc">
        <div class="ProseMirror">
          <h1>첫 제목</h1>
          <summary class="toggle-header" data-title-level="2">제목 토글</summary>
        </div>
      </div>
    `;
    const target = document.querySelector("summary") as HTMLElement;
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      top: 240,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 240,
      toJSON: () => ({}),
    });
    Object.defineProperty(window, "scrollY", {
      value: 100,
      configurable: true,
    });
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    expect(
      scrollPublicOutlineTargetIntoView(1, {
        behavior: "auto",
        topOffset: 80,
      }),
    ).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith({ top: 260, behavior: "auto" });
  });
});
