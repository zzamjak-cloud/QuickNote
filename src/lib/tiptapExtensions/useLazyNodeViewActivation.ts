import { useCallback, useEffect, useRef, useState } from "react";
import { preserveMediaScrollPosition } from "../editor/mediaScrollPreserver";

type LazyNodeViewActivationOptions = {
  selected?: boolean;
  forceActive?: boolean;
  rootMargin?: string;
  /** 마운트 즉시 active 로 시작(예: 컨텐츠가 이미 캐시돼 지연 로드가 불필요할 때). */
  initialActive?: boolean;
  /** iframe/img 삽입 직후 스크롤 앵커링으로 위쪽 점프가 생기면 보정한다. */
  preserveScrollOnActivate?: boolean;
};

export function useLazyNodeViewActivation<T extends HTMLElement>({
  selected = false,
  forceActive = false,
  rootMargin = "800px 0px",
  initialActive = false,
  preserveScrollOnActivate = false,
}: LazyNodeViewActivationOptions = {}) {
  const ref = useRef<T | null>(null);
  const [active, setActive] = useState(() => selected || forceActive || initialActive);

  const preserveScroll = useCallback(() => {
    if (!preserveScrollOnActivate) return;
    preserveMediaScrollPosition(ref.current);
  }, [preserveScrollOnActivate]);

  const activate = useCallback(() => {
    if (!active) preserveScroll();
    setActive(true);
  }, [active, preserveScroll]);

  useEffect(() => {
    if (!active && (selected || forceActive)) {
      preserveScroll();
      setActive(true);
    }
  }, [active, forceActive, preserveScroll, selected]);

  useEffect(() => {
    if (active || selected || forceActive) return;
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      if (preserveScrollOnActivate) preserveMediaScrollPosition(element);
      setActive(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries.some(
            (entry) => entry.isIntersecting || entry.intersectionRatio > 0,
          )
        ) {
          if (preserveScrollOnActivate) preserveMediaScrollPosition(element);
          setActive(true);
          observer.disconnect();
        }
      },
      { root: null, rootMargin, threshold: 0.01 },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [active, forceActive, preserveScrollOnActivate, rootMargin, selected]);

  return { ref, active, activate, preserveScroll };
}
