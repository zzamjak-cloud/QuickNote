import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

type WindowedRowsOptions = {
  count: number;
  estimateSize: number;
  enabled: boolean;
  overscan?: number;
};

export type WindowedRows = {
  containerRef: (node: HTMLElement | null) => void;
  enabled: boolean;
  start: number;
  end: number;
  topPadding: number;
  bottomPadding: number;
  totalSize: number;
};

const INITIAL_FALLBACK_ROWS = 60;

export function useWindowedRows({
  count,
  estimateSize,
  enabled,
  overscan = 8,
}: WindowedRowsOptions): WindowedRows {
  const containerRef = useRef<HTMLElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [range, setRange] = useState(() => ({
    start: 0,
    end: enabled ? Math.min(count, INITIAL_FALLBACK_ROWS) : count,
  }));
  const rangeRef = useRef(range);

  const commitRange = useCallback((next: { start: number; end: number }) => {
    const prev = rangeRef.current;
    if (prev.start === next.start && prev.end === next.end) return;
    rangeRef.current = next;
    setRange(next);
  }, []);

  const calculate = useCallback(() => {
    if (!enabled || count === 0) {
      commitRange({ start: 0, end: count });
      return;
    }
    const node = containerRef.current;
    if (!node) {
      const end = Math.min(count, INITIAL_FALLBACK_ROWS);
      commitRange({ start: 0, end });
      return;
    }

    const rect = node.getBoundingClientRect();
    const viewportTop = Math.max(0, -rect.top);
    const viewportBottom = Math.min(
      count * estimateSize,
      viewportTop + window.innerHeight,
    );
    const nextStart = Math.max(0, Math.floor(viewportTop / estimateSize) - overscan);
    const nextEnd = Math.min(
      count,
      Math.ceil(viewportBottom / estimateSize) + overscan,
    );
    commitRange({ start: nextStart, end: nextEnd });
  }, [commitRange, count, enabled, estimateSize, overscan]);

  const schedule = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      calculate();
    });
  }, [calculate]);

  const setContainerRef = useCallback(
    (node: HTMLElement | null) => {
      containerRef.current = node;
      schedule();
    },
    [schedule],
  );

  useLayoutEffect(() => {
    calculate();
  }, [calculate]);

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [enabled, schedule]);

  const start = enabled ? range.start : 0;
  const end = enabled ? range.end : count;
  return useMemo(
    () => ({
      containerRef: setContainerRef,
      enabled,
      start,
      end,
      topPadding: start * estimateSize,
      bottomPadding: Math.max(0, (count - end) * estimateSize),
      totalSize: count * estimateSize,
    }),
    [count, enabled, end, estimateSize, setContainerRef, start],
  );
}
