import { useCallback, useEffect, useRef, useState } from "react";

type LazyNodeViewActivationOptions = {
  selected?: boolean;
  forceActive?: boolean;
  rootMargin?: string;
};

export function useLazyNodeViewActivation<T extends HTMLElement>({
  selected = false,
  forceActive = false,
  rootMargin = "800px 0px",
}: LazyNodeViewActivationOptions = {}) {
  const ref = useRef<T | null>(null);
  const [active, setActive] = useState(() => selected || forceActive);

  const activate = useCallback(() => {
    setActive(true);
  }, []);

  useEffect(() => {
    if (!active && (selected || forceActive)) {
      setActive(true);
    }
  }, [active, forceActive, selected]);

  useEffect(() => {
    if (active || selected || forceActive) return;
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
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
          setActive(true);
          observer.disconnect();
        }
      },
      { root: null, rootMargin, threshold: 0.01 },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [active, forceActive, rootMargin, selected]);

  return { ref, active, activate };
}
