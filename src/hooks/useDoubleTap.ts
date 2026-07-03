import { useCallback, useMemo, useRef, type TouchEvent as ReactTouchEvent } from "react";

// 터치 더블탭 감지 훅.
// 스케줄러 카드는 react-rnd(react-draggable)가 touchstart 에서 preventDefault 하므로
// 브라우저가 합성 click/dblclick 을 생성하지 않는다 → onDoubleClick 이 터치에서 발화 불가.
// 터치 이벤트 자체는 정상 발화하므로 onTouchStart/onTouchEnd 로 더블탭을 직접 감지한다.
// 마우스 환경에는 영향 없음(touch 이벤트 미발생) — 기존 onDoubleClick 과 공존한다.
//
// - useDoubleTap: 카드 컴포넌트 1개당 1개 인스턴스. <div {...doubleTapHandlers} /> 로 스프레드.
// - useDoubleTapByKey: 리스트 렌더(map) 내부처럼 카드별 훅 호출이 불가능할 때
//   컨테이너 컴포넌트에 1개만 두고 카드별 key(pageId 등)로 구분한다.
//   같은 key 에 연속 두 탭이 와야 더블탭으로 인정한다.

/** 한 번의 탭으로 인정하는 최대 누름 시간(ms). 초과 시 롱프레스/드래그로 간주. */
const TAP_MAX_PRESS_MS = 500;
/** 탭 중 허용 이동 거리(px). 초과 시 드래그로 간주.
 *  실기기 손가락 탭은 누르는 동안 10~20px 흔들리는 게 흔하므로 넉넉히 잡는다.
 *  너무 좁으면(12px) 정상 탭이 드래그로 오판되어 더블탭이 영구 불성립한다. */
const TAP_MOVE_SLOP_PX = 24;
/** 두 탭 사이 최대 간격(ms). */
const DOUBLE_TAP_INTERVAL_MS = 400;
/** 두 탭 사이 허용 좌표 편차(px). */
const DOUBLE_TAP_DISTANCE_PX = 40;

type TapPoint = { time: number; x: number; y: number; key: string };

export function useDoubleTapByKey(onDoubleTap: (key: string) => void): {
  onTouchStart: (key: string, e: ReactTouchEvent) => void;
  onTouchEnd: (key: string, e: ReactTouchEvent) => void;
  onTouchCancel: () => void;
} {
  // 인라인 콜백이 매 렌더마다 바뀌어도 핸들러 참조가 안정되도록 ref 로 보관
  const callbackRef = useRef(onDoubleTap);
  callbackRef.current = onDoubleTap;

  const touchStartRef = useRef<TapPoint | null>(null);
  const lastTapRef = useRef<TapPoint | null>(null);

  const onTouchStart = useCallback((key: string, e: ReactTouchEvent) => {
    // 멀티터치(핀치 등)는 탭 후보에서 제외
    if (e.touches.length !== 1) {
      touchStartRef.current = null;
      return;
    }
    const touch = e.touches[0];
    if (!touch) return;
    touchStartRef.current = { time: e.timeStamp, x: touch.clientX, y: touch.clientY, key };
  }, []);

  const onTouchEnd = useCallback((key: string, e: ReactTouchEvent) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    // 손가락이 남아있거나 시작점이 없거나 다른 카드에서 시작했으면 탭 아님
    if (!start || start.key !== key || e.touches.length > 0) return;
    const touch = e.changedTouches[0];
    if (!touch) return;

    // 롱프레스·드래그는 탭으로 치지 않고 이전 탭 기록도 초기화
    const pressedTooLong = e.timeStamp - start.time > TAP_MAX_PRESS_MS;
    const moved =
      Math.abs(touch.clientX - start.x) > TAP_MOVE_SLOP_PX ||
      Math.abs(touch.clientY - start.y) > TAP_MOVE_SLOP_PX;
    if (pressedTooLong || moved) {
      lastTapRef.current = null;
      return;
    }

    const last = lastTapRef.current;
    const isDoubleTap =
      last !== null &&
      last.key === key &&
      e.timeStamp - last.time < DOUBLE_TAP_INTERVAL_MS &&
      Math.abs(touch.clientX - last.x) < DOUBLE_TAP_DISTANCE_PX &&
      Math.abs(touch.clientY - last.y) < DOUBLE_TAP_DISTANCE_PX;

    if (isDoubleTap) {
      lastTapRef.current = null;
      callbackRef.current(key);
    } else {
      lastTapRef.current = { time: e.timeStamp, x: touch.clientX, y: touch.clientY, key };
    }
  }, []);

  // 시스템이 터치를 가로챈 경우(touchcancel) 탭 상태 전체 초기화
  const onTouchCancel = useCallback(() => {
    touchStartRef.current = null;
    lastTapRef.current = null;
  }, []);

  // 핸들러가 모두 안정 참조이므로 반환 객체도 안정화(memo 카드 불필요 리렌더 방지)
  return useMemo(
    () => ({ onTouchStart, onTouchEnd, onTouchCancel }),
    [onTouchStart, onTouchEnd, onTouchCancel],
  );
}

/** 단일 대상용 더블탭 훅 — 반환 핸들러를 대상 엘리먼트에 스프레드한다. */
const SINGLE_TARGET_KEY = "single";

export function useDoubleTap(onDoubleTap: () => void): {
  onTouchStart: (e: ReactTouchEvent) => void;
  onTouchEnd: (e: ReactTouchEvent) => void;
  onTouchCancel: () => void;
} {
  const keyed = useDoubleTapByKey(onDoubleTap);
  return useMemo(
    () => ({
      onTouchStart: (e: ReactTouchEvent) => keyed.onTouchStart(SINGLE_TARGET_KEY, e),
      onTouchEnd: (e: ReactTouchEvent) => keyed.onTouchEnd(SINGLE_TARGET_KEY, e),
      onTouchCancel: keyed.onTouchCancel,
    }),
    [keyed],
  );
}
