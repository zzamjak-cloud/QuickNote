// 데이터베이스 뷰의 행 가상화 hook.
// 내부 구현은 @tanstack/react-virtual 의 useWindowVirtualizer 위에서 동작하되,
// 외부 인터페이스(containerRef/start/end/topPadding/bottomPadding/totalSize) 는
// 종전과 동일하게 유지해 호출처(DataaseListView/TimelineView/TableView) 수정 불필요.
import { useCallback, useMemo, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";

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

// containerRef 이 아직 마운트 안 됐을 때(초기 1프레임) 보여줄 fallback 행 수.
// 기존 구현과 동일한 기본값.
const INITIAL_FALLBACK_ROWS = 60;

export function useWindowedRows({
  count,
  estimateSize,
  enabled,
  overscan = 8,
}: WindowedRowsOptions): WindowedRows {
  const [scrollMargin, setScrollMargin] = useState(0);

  const containerRef = useCallback((node: HTMLElement | null) => {
    if (!node) {
      setScrollMargin(0);
      return;
    }
    // container 의 document 최상단 기준 offset. window scroll 위치 + element 의 viewport top.
    const next = node.getBoundingClientRect().top + window.scrollY;
    setScrollMargin((prev) => (Math.abs(prev - next) < 0.5 ? prev : next));
  }, []);

  const virtualizer = useWindowVirtualizer({
    count: enabled ? count : 0,
    estimateSize: () => estimateSize,
    overscan,
    scrollMargin,
  });

  return useMemo(() => {
    if (!enabled) {
      return {
        containerRef,
        enabled: false,
        start: 0,
        end: count,
        topPadding: 0,
        bottomPadding: 0,
        totalSize: count * estimateSize,
      };
    }
    const items = virtualizer.getVirtualItems();
    const totalSize = virtualizer.getTotalSize();
    if (items.length === 0) {
      // 마운트 직후 또는 jsdom 환경에서 virtualizer 가 아직 viewport 를 파악 못한 경우
      const end = Math.min(count, INITIAL_FALLBACK_ROWS);
      return {
        containerRef,
        enabled: true,
        start: 0,
        end,
        topPadding: 0,
        bottomPadding: Math.max(0, (count - end) * estimateSize),
        totalSize,
      };
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    return {
      containerRef,
      enabled: true,
      start: first.index,
      end: last.index + 1,
      topPadding: first.start,
      bottomPadding: Math.max(0, totalSize - last.end),
      totalSize,
    };
  }, [containerRef, count, enabled, estimateSize, virtualizer]);
}
