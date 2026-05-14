import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 데이터 테이블 행 선택 — 체크박스 기반.
 *  - 단일 체크박스 클릭 → 해당 행 토글
 *  - Shift + 체크박스 클릭 → 마지막 클릭 행부터 현재 행까지 범위 선택(체크 추가)
 *  - 전체 토글(헤더 체크박스) → 전부 체크/해제
 *  - 행 삭제 시 사라진 id 자동 정리
 */
export function useTableRowSelection(rowIds: readonly string[]) {
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(() => new Set());
  const lastClickedIndexRef = useRef<number | null>(null);
  const rowIdsRef = useRef(rowIds);
  rowIdsRef.current = rowIds;

  const handleCheckboxClick = useCallback(
    (rowId: string, opts: { shiftKey: boolean }) => {
      const ids = rowIdsRef.current;
      const idx = ids.indexOf(rowId);
      if (idx < 0) return;

      if (opts.shiftKey && lastClickedIndexRef.current != null) {
        // 범위 선택: 마지막 anchor 부터 현재 행까지 모두 체크 추가
        const start = Math.min(lastClickedIndexRef.current, idx);
        const end = Math.max(lastClickedIndexRef.current, idx);
        setSelectedRowIds((prev) => {
          const next = new Set(prev);
          for (let i = start; i <= end; i++) {
            const id = ids[i];
            if (id) next.add(id);
          }
          return next;
        });
        // anchor 는 유지 (표준 shift-multi 동작)
        return;
      }

      // 단일 토글
      setSelectedRowIds((prev) => {
        const next = new Set(prev);
        if (next.has(rowId)) next.delete(rowId);
        else next.add(rowId);
        return next;
      });
      lastClickedIndexRef.current = idx;
    },
    [],
  );

  const toggleAll = useCallback(() => {
    setSelectedRowIds((prev) => {
      const ids = rowIdsRef.current;
      if (prev.size > 0) return new Set(); // 일부/전체 선택 → 모두 해제
      return new Set(ids);
    });
    lastClickedIndexRef.current = null;
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedRowIds((prev) => (prev.size === 0 ? prev : new Set()));
    lastClickedIndexRef.current = null;
  }, []);

  // rowIds 변경(행 삭제 등) 시 사라진 id 자동 제거
  // 참조가 아닌 내용 기준으로 비교해 무한 루프 방지
  const rowIdsKey = rowIds.join(",");
  useEffect(() => {
    setSelectedRowIds((prev) => {
      if (prev.size === 0) return prev;
      const valid = new Set(rowIdsRef.current);
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (valid.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowIdsKey]);

  return { selectedRowIds, handleCheckboxClick, toggleAll, clearSelection };
}
