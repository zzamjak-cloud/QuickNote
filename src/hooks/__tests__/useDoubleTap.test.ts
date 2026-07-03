// useDoubleTap 판정 로직 테스트 — 실기기 손가락 오차(탭 중 흔들림)에도 더블탭이 성립해야 한다.
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { TouchEvent as ReactTouchEvent } from "react";
import { useDoubleTap, useDoubleTapByKey } from "../useDoubleTap";

type Point = { x: number; y: number };

function touchEvent(args: {
  time: number;
  point: Point;
  /** touchstart 시 남아있는 손가락(기본 1개), touchend 시 0개 */
  activeTouches?: Point[];
}): ReactTouchEvent {
  const toTouch = (p: Point) => ({ clientX: p.x, clientY: p.y });
  return {
    timeStamp: args.time,
    touches: (args.activeTouches ?? []).map(toTouch),
    changedTouches: [toTouch(args.point)],
  } as unknown as ReactTouchEvent;
}

/** start~end 한 번의 탭을 시뮬레이션 */
function tap(
  handlers: ReturnType<typeof useDoubleTap>,
  args: { startTime: number; startPoint: Point; endTime: number; endPoint: Point },
) {
  handlers.onTouchStart(
    touchEvent({ time: args.startTime, point: args.startPoint, activeTouches: [args.startPoint] }),
  );
  handlers.onTouchEnd(touchEvent({ time: args.endTime, point: args.endPoint }));
}

describe("useDoubleTap", () => {
  it("두 번의 깨끗한 탭 → 콜백 발화", () => {
    const onDoubleTap = vi.fn();
    const { result } = renderHook(() => useDoubleTap(onDoubleTap));

    tap(result.current, { startTime: 0, startPoint: { x: 100, y: 100 }, endTime: 80, endPoint: { x: 100, y: 100 } });
    tap(result.current, { startTime: 250, startPoint: { x: 105, y: 102 }, endTime: 330, endPoint: { x: 105, y: 102 } });

    expect(onDoubleTap).toHaveBeenCalledTimes(1);
  });

  it("실기기 손가락 흔들림(탭 중 ~20px 이동)에도 더블탭 성립 — 회귀 방지", () => {
    const onDoubleTap = vi.fn();
    const { result } = renderHook(() => useDoubleTap(onDoubleTap));

    // 각 탭에서 누르는 동안 20px 밀림 (기존 slop 12px 에서는 드래그로 오판되던 케이스)
    tap(result.current, { startTime: 0, startPoint: { x: 100, y: 100 }, endTime: 100, endPoint: { x: 118, y: 108 } });
    tap(result.current, { startTime: 300, startPoint: { x: 110, y: 104 }, endTime: 400, endPoint: { x: 95, y: 110 } });

    expect(onDoubleTap).toHaveBeenCalledTimes(1);
  });

  it("드래그(큰 이동) 후 탭 → 발화하지 않고 기록 초기화", () => {
    const onDoubleTap = vi.fn();
    const { result } = renderHook(() => useDoubleTap(onDoubleTap));

    // 60px 드래그 — 탭 아님
    tap(result.current, { startTime: 0, startPoint: { x: 100, y: 100 }, endTime: 200, endPoint: { x: 160, y: 100 } });
    // 직후 탭 1회 — 더블탭 성립하면 안 됨
    tap(result.current, { startTime: 300, startPoint: { x: 160, y: 100 }, endTime: 380, endPoint: { x: 160, y: 100 } });

    expect(onDoubleTap).not.toHaveBeenCalled();
  });

  it("롱프레스(500ms 초과)는 탭으로 치지 않음", () => {
    const onDoubleTap = vi.fn();
    const { result } = renderHook(() => useDoubleTap(onDoubleTap));

    tap(result.current, { startTime: 0, startPoint: { x: 100, y: 100 }, endTime: 700, endPoint: { x: 100, y: 100 } });
    tap(result.current, { startTime: 800, startPoint: { x: 100, y: 100 }, endTime: 880, endPoint: { x: 100, y: 100 } });

    expect(onDoubleTap).not.toHaveBeenCalled();
  });

  it("두 탭 간격이 400ms 초과면 발화하지 않음", () => {
    const onDoubleTap = vi.fn();
    const { result } = renderHook(() => useDoubleTap(onDoubleTap));

    tap(result.current, { startTime: 0, startPoint: { x: 100, y: 100 }, endTime: 80, endPoint: { x: 100, y: 100 } });
    tap(result.current, { startTime: 600, startPoint: { x: 100, y: 100 }, endTime: 680, endPoint: { x: 100, y: 100 } });

    expect(onDoubleTap).not.toHaveBeenCalled();
  });

  it("멀티터치(핀치)는 탭 후보에서 제외", () => {
    const onDoubleTap = vi.fn();
    const { result } = renderHook(() => useDoubleTap(onDoubleTap));

    const p = { x: 100, y: 100 };
    // 두 손가락 시작 → 탭 후보 아님
    result.current.onTouchStart(touchEvent({ time: 0, point: p, activeTouches: [p, { x: 200, y: 200 }] }));
    result.current.onTouchEnd(touchEvent({ time: 80, point: p }));
    tap(result.current, { startTime: 200, startPoint: p, endTime: 280, endPoint: p });

    expect(onDoubleTap).not.toHaveBeenCalled();
  });

  it("touchcancel 시 탭 상태 초기화", () => {
    const onDoubleTap = vi.fn();
    const { result } = renderHook(() => useDoubleTap(onDoubleTap));

    tap(result.current, { startTime: 0, startPoint: { x: 100, y: 100 }, endTime: 80, endPoint: { x: 100, y: 100 } });
    result.current.onTouchCancel();
    tap(result.current, { startTime: 200, startPoint: { x: 100, y: 100 }, endTime: 280, endPoint: { x: 100, y: 100 } });

    expect(onDoubleTap).not.toHaveBeenCalled();
  });

  it("useDoubleTapByKey: 같은 key 두 탭 → 해당 key 로 발화, 다른 key 는 불성립", () => {
    const onDoubleTap = vi.fn();
    const { result } = renderHook(() => useDoubleTapByKey(onDoubleTap));
    const p = { x: 100, y: 100 };
    const tapKeyed = (key: string, startTime: number) => {
      result.current.onTouchStart(key, touchEvent({ time: startTime, point: p, activeTouches: [p] }));
      result.current.onTouchEnd(key, touchEvent({ time: startTime + 80, point: p }));
    };

    // 서로 다른 카드에 연속 탭 → 발화 안 함
    tapKeyed("card-a", 0);
    tapKeyed("card-b", 200);
    expect(onDoubleTap).not.toHaveBeenCalled();

    // 같은 카드에 연속 두 탭 → 해당 key 로 발화
    tapKeyed("card-a", 1000);
    tapKeyed("card-a", 1250);
    expect(onDoubleTap).toHaveBeenCalledTimes(1);
    expect(onDoubleTap).toHaveBeenCalledWith("card-a");
  });

  it("연속 3탭 — 첫 더블탭 발화 후 상태 초기화되어 중복 발화 없음", () => {
    const onDoubleTap = vi.fn();
    const { result } = renderHook(() => useDoubleTap(onDoubleTap));

    const p = { x: 100, y: 100 };
    tap(result.current, { startTime: 0, startPoint: p, endTime: 80, endPoint: p });
    tap(result.current, { startTime: 200, startPoint: p, endTime: 280, endPoint: p });
    tap(result.current, { startTime: 400, startPoint: p, endTime: 480, endPoint: p });

    expect(onDoubleTap).toHaveBeenCalledTimes(1);
  });
});
