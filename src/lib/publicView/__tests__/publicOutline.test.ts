import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PUBLIC_OUTLINE_FOCUS_CLASS,
  findPublicOutlineTargets,
  scrollPublicOutlineTargetIntoView,
} from "../publicOutline";

describe("publicOutline", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
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

  it("공개 뷰어 스크롤 컨테이너 안에서는 window 대신 컨테이너를 스크롤한다", () => {
    document.body.innerHTML = `
      <div data-qn-public-scroll-host="true">
        <div class="qn-public-doc">
          <div class="ProseMirror">
            <h1>첫 제목</h1>
            <summary class="toggle-header" data-title-level="2">제목 토글</summary>
          </div>
        </div>
      </div>
    `;
    const host = document.querySelector(
      "[data-qn-public-scroll-host='true']",
    ) as HTMLElement;
    const target = document.querySelector("summary") as HTMLElement;
    host.scrollTop = 120;
    host.scrollTo = vi.fn();
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue({
      top: 40,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 40,
      toJSON: () => ({}),
    });
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      top: 360,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 360,
      toJSON: () => ({}),
    });
    const windowScrollTo = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => undefined);

    expect(
      scrollPublicOutlineTargetIntoView(1, {
        behavior: "auto",
        topOffset: 80,
      }),
    ).toBe(true);
    expect(host.scrollTo).toHaveBeenCalledWith({ top: 360, behavior: "auto" });
    expect(windowScrollTo).not.toHaveBeenCalled();
  });

  it("목차 이동 대상에 일시적인 포커스 피드백 클래스를 부여한다", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <div class="qn-public-doc">
        <div class="ProseMirror">
          <h2>강조 대상</h2>
        </div>
      </div>
    `;
    const target = document.querySelector("h2") as HTMLElement;
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    expect(scrollPublicOutlineTargetIntoView(0, { behavior: "auto", flash: true })).toBe(true);
    expect(target.classList.contains(PUBLIC_OUTLINE_FOCUS_CLASS)).toBe(true);

    vi.advanceTimersByTime(1600);
    expect(target.classList.contains(PUBLIC_OUTLINE_FOCUS_CLASS)).toBe(false);
  });
});
