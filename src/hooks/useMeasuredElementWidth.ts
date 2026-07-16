import { useCallback, useRef, useState } from "react";

/**
 * 미디어(video/img) 요소의 실측 표시 폭.
 *
 * width attr 이 없는 미디어는 원본 크기(auto)로 렌더되어 저장 attr 로는 표시 폭을 알 수 없다.
 * 캡션 박스 폭을 100% 로 두면 중앙/우측 정렬이 미디어가 아닌 블록 폭 기준이 되므로,
 * ResizeObserver 로 실측해 캡션 정렬 기준폭으로 쓴다.
 */
export function useMeasuredElementWidth(): {
  ref: (el: HTMLElement | null) => void;
  width: number | null;
} {
  const [width, setWidth] = useState<number | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  const ref = useCallback((el: HTMLElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el) {
      setWidth(null);
      return;
    }
    const update = () => {
      const w = el.getBoundingClientRect().width;
      setWidth(w > 0 ? Math.round(w) : null);
    };
    update();
    // jsdom 등 ResizeObserver 미지원 환경에선 최초 실측만 사용
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(update);
      observer.observe(el);
      observerRef.current = observer;
    }
  }, []);

  return { ref, width };
}
