import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { animateScrollLeft } from "../../../../lib/animateScroll";

// scrollLeft 만 갖는 최소 stub element. requestAnimationFrame 은 vitest 가짜 타이머로 구동한다.
function makeStubEl(initial = 0): HTMLElement {
  return { scrollLeft: initial } as unknown as HTMLElement;
}

describe("animateScrollLeft", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // matchMedia 미정의 환경 → reduceMotion=false (애니메이션 수행).
    vi.stubGlobal("matchMedia", undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("duration 이 지나면 정확히 목표값에 도달한다", () => {
    const el = makeStubEl(0);
    animateScrollLeft(el, 1000, 300);

    // 진행 중에는 목표보다 작다(easeOutCubic 이라 초반에 빠르게 증가).
    vi.advanceTimersByTime(150);
    expect(el.scrollLeft).toBeGreaterThan(0);
    expect(el.scrollLeft).toBeLessThan(1000);

    // duration 경과 후 정확히 목표값.
    vi.advanceTimersByTime(300);
    expect(el.scrollLeft).toBe(1000);
  });

  it("완료 시 onComplete 를 1회 호출하고, cancel 시에는 호출하지 않는다", () => {
    const onDone = vi.fn();
    animateScrollLeft(makeStubEl(0), 1000, 300, onDone);
    vi.advanceTimersByTime(400);
    expect(onDone).toHaveBeenCalledTimes(1);

    const onDone2 = vi.fn();
    const handle = animateScrollLeft(makeStubEl(0), 1000, 300, onDone2);
    vi.advanceTimersByTime(60);
    handle.cancel();
    vi.advanceTimersByTime(600);
    expect(onDone2).not.toHaveBeenCalled();
  });

  it("onFrame 은 매 프레임 현재 scrollLeft 로 호출되고 마지막엔 목표값을 전달한다", () => {
    const el = makeStubEl(0);
    const frames: number[] = [];
    animateScrollLeft(el, 1000, 300, undefined, (sl) => frames.push(sl));
    vi.advanceTimersByTime(400);
    expect(frames.length).toBeGreaterThan(1);
    // 단조 증가(easeOutCubic) + 마지막 프레임은 정확히 목표값.
    expect(frames[frames.length - 1]).toBe(1000);
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i]).toBeGreaterThanOrEqual(frames[i - 1]!);
    }
  });

  it("cancel 하면 이후 프레임에서 더 이상 갱신하지 않는다", () => {
    const el = makeStubEl(0);
    const handle = animateScrollLeft(el, 1000, 300);
    vi.advanceTimersByTime(60);
    const mid = el.scrollLeft;
    expect(mid).toBeGreaterThan(0);
    handle.cancel();
    vi.advanceTimersByTime(600);
    expect(el.scrollLeft).toBe(mid);
  });

  it("prefers-reduced-motion 이어도 애니메이션한다(사용자가 명시 요청한 기능성 스크롤이라 의도적으로 무시)", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("reduce"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const el = makeStubEl(0);
    animateScrollLeft(el, 500, 300);
    // 진행 중에는 목표에 도달하지 않는다(즉시 점프가 아님 = reduced-motion 을 무시하고 애니메이션).
    vi.advanceTimersByTime(150);
    expect(el.scrollLeft).toBeGreaterThan(0);
    expect(el.scrollLeft).toBeLessThan(500);
    // duration 후 정확히 도달.
    vi.advanceTimersByTime(300);
    expect(el.scrollLeft).toBe(500);
  });
});
