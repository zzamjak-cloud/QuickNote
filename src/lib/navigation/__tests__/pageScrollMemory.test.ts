import { afterEach, describe, expect, it } from "vitest";
import {
  installPageScrollCapture,
  isLikelyVerticalScrollbarInput,
  restorePageScrollPosition,
  savePageScrollPosition,
} from "../pageScrollMemory";

const originalResizeObserver = globalThis.ResizeObserver;

class TestResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

function rect(top: number, height: number, left = 20, width = 300): DOMRect {
  return {
    x: left,
    y: top,
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

function makeScroller(): HTMLElement {
  const el = document.createElement("div");
  el.dataset.qnScrollPageId = "page-scroll-test";
  el.dataset.qnScrollScope = "main";
  Object.defineProperties(el, {
    scrollHeight: { value: 1200, configurable: true },
    clientHeight: { value: 500, configurable: true },
    scrollWidth: { value: 300, configurable: true },
    clientWidth: { value: 285, configurable: true },
    offsetWidth: { value: 300, configurable: true },
  });
  el.getBoundingClientRect = () => rect(10, 500);
  document.body.appendChild(el);
  return el;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

afterEach(() => {
  document.body.replaceChildren();
  sessionStorage.clear();
  globalThis.ResizeObserver = originalResizeObserver;
});

describe("page scroll memory", () => {
  it("detects direct native scrollbar input", () => {
    const scroller = makeScroller();
    const event = new MouseEvent("mousedown", { clientX: 315, clientY: 30 });

    expect(isLikelyVerticalScrollbarInput(event, scroller)).toBe(true);
  });

  it("does not re-apply restore when native scrollbar drag only emits scroll events", async () => {
    globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;
    const uninstall = installPageScrollCapture();
    const scroller = makeScroller();
    scroller.scrollTop = 320;
    savePageScrollPosition("page-scroll-test", scroller, "main", { force: true });
    scroller.scrollTop = 0;
    const cleanupRestore = restorePageScrollPosition("page-scroll-test", scroller, "main", 1000);

    expect(scroller.scrollTop).toBe(320);

    scroller.scrollTop = 700;
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    await nextFrame();
    await nextFrame();

    expect(scroller.scrollTop).toBe(700);

    cleanupRestore?.();
    uninstall?.();
  });
});
