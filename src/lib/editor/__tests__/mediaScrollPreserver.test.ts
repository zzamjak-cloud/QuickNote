import { afterEach, describe, expect, it } from "vitest";
import { preserveMediaScrollPosition } from "../mediaScrollPreserver";

function makeScroller(): { scroller: HTMLElement; target: HTMLElement } {
  const scroller = document.createElement("div");
  scroller.className = "qn-editor-body-scroll";
  Object.defineProperties(scroller, {
    scrollHeight: { value: 1800, configurable: true },
    clientHeight: { value: 600, configurable: true },
    clientWidth: { value: 280, configurable: true },
    offsetWidth: { value: 300, configurable: true },
  });
  scroller.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      width: 300,
      height: 600,
      right: 300,
      bottom: 600,
      toJSON: () => ({}),
    }) as DOMRect;

  const target = document.createElement("div");
  scroller.appendChild(target);
  document.body.appendChild(scroller);
  return { scroller, target };
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("mediaScrollPreserver", () => {
  it("미디어 로드가 위쪽 스크롤 점프를 만들면 기존 위치로 되돌린다", async () => {
    const { scroller, target } = makeScroller();
    scroller.scrollTop = 420;

    const stop = preserveMediaScrollPosition(target, { durationMs: 1000 });
    scroller.scrollTop = 120;
    await nextFrame();

    expect(scroller.scrollTop).toBe(420);
    stop?.();
  });

  it("사용자가 아래로 계속 스크롤하면 새 위치를 기준으로 보존한다", async () => {
    const { scroller, target } = makeScroller();
    scroller.scrollTop = 420;

    const stop = preserveMediaScrollPosition(target, { durationMs: 1000 });
    scroller.scrollTop = 520;
    await nextFrame();
    scroller.scrollTop = 180;
    await nextFrame();

    expect(scroller.scrollTop).toBe(520);
    stop?.();
  });

  it("사용자가 명시적으로 위로 스크롤하면 보정을 중단한다", async () => {
    const { scroller, target } = makeScroller();
    scroller.scrollTop = 420;

    const stop = preserveMediaScrollPosition(target, { durationMs: 1000 });
    scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, bubbles: true }));
    scroller.scrollTop = 120;
    await nextFrame();

    expect(scroller.scrollTop).toBe(120);
    stop?.();
  });
});
