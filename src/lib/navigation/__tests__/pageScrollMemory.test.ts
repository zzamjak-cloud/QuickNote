import { afterEach, describe, expect, it } from "vitest";
import {
  installPageScrollCapture,
  isLikelyVerticalScrollbarInput,
  markProgrammaticScroll,
  restorePageScrollPosition,
  savePageScrollPosition,
} from "../pageScrollMemory";

const originalResizeObserver = globalThis.ResizeObserver;

class TestResizeObserver {
  static latest: TestResizeObserver | null = null;

  constructor(private readonly callback: ResizeObserverCallback) {
    TestResizeObserver.latest = this;
  }

  observe(): void {}
  disconnect(): void {}

  trigger(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
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
  TestResizeObserver.latest = null;
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

    await nextFrame();
    expect(scroller.scrollTop).toBe(320);

    scroller.scrollTop = 700;
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    await nextFrame();
    await nextFrame();

    expect(scroller.scrollTop).toBe(700);

    cleanupRestore?.();
    uninstall?.();
  });

  it("stops restoring after the saved position becomes reachable", async () => {
    globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;
    const scroller = makeScroller();
    scroller.scrollTop = 320;
    savePageScrollPosition("page-scroll-test", scroller, "main", { force: true });
    scroller.scrollTop = 0;
    const cleanupRestore = restorePageScrollPosition("page-scroll-test", scroller, "main", 1000);

    await nextFrame();
    expect(scroller.scrollTop).toBe(320);

    scroller.scrollTop = 640;
    scroller.appendChild(document.createElement("div"));
    await nextFrame();
    await nextFrame();

    expect(scroller.scrollTop).toBe(640);
    cleanupRestore?.();
  });

  it("yields when the user scrolls before the first restore frame", async () => {
    globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;
    const scroller = makeScroller();
    scroller.scrollTop = 320;
    savePageScrollPosition("page-scroll-test", scroller, "main", { force: true });
    scroller.scrollTop = 0;
    const cleanupRestore = restorePageScrollPosition("page-scroll-test", scroller, "main", 1000);

    scroller.scrollTop = 500;
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    await nextFrame();

    expect(scroller.scrollTop).toBe(500);
    cleanupRestore?.();
  });

  it("waits only while the saved position is unreachable, then restores once", async () => {
    globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;
    const scroller = makeScroller();
    let scrollHeight = 500;
    Object.defineProperty(scroller, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
    scroller.scrollTop = 600;
    savePageScrollPosition("page-scroll-test", scroller, "main", { force: true });
    scroller.scrollTop = 0;
    const cleanupRestore = restorePageScrollPosition("page-scroll-test", scroller, "main", 1000);

    await nextFrame();
    expect(scroller.scrollTop).toBe(0);

    scrollHeight = 1400;
    TestResizeObserver.latest?.trigger();
    await nextFrame();
    expect(scroller.scrollTop).toBe(600);

    scroller.scrollTop = 700;
    TestResizeObserver.latest?.trigger();
    await nextFrame();
    expect(scroller.scrollTop).toBe(700);
    cleanupRestore?.();
  });

  it("keeps the user's scroll when media activation suddenly resets to top", async () => {
    const uninstall = installPageScrollCapture();
    const scroller = makeScroller();
    scroller.scrollTop = 360;
    savePageScrollPosition("page-scroll-test", scroller, "main", { force: true });

    scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: 120, bubbles: true }));
    scroller.scrollTop = 420;
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));

    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    await nextFrame();

    expect(scroller.scrollTop).toBe(420);
    uninstall?.();
  });

  it("allows an explicit user scroll back to the top", () => {
    const uninstall = installPageScrollCapture();
    const scroller = makeScroller();
    scroller.scrollTop = 420;
    savePageScrollPosition("page-scroll-test", scroller, "main", { force: true });

    scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, bubbles: true }));
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));

    expect(scroller.scrollTop).toBe(0);
    uninstall?.();
  });

  it("allows an explicit programmatic scroll back to the top", () => {
    const scroller = makeScroller();
    scroller.scrollTop = 420;
    savePageScrollPosition("page-scroll-test", scroller, "main", { force: true });

    markProgrammaticScroll();
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));

    expect(scroller.scrollTop).toBe(0);
  });
});
