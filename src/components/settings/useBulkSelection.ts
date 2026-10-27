import { useCallback, useMemo, useState } from "react";

/**
 * 목록 일괄 선택 상태. 검색 등으로 화면에서 사라진 항목은 체크돼 있어도
 * selectedIds 에서 제외해, 보이지 않는 항목이 일괄 작업에 섞이지 않게 한다.
 */
export function useBulkSelection(visibleIds: string[]) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set());

  const selectedIds = useMemo(
    () => visibleIds.filter((id) => checked.has(id)),
    [visibleIds, checked],
  );

  const toggle = useCallback((id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allSelected = visibleIds.length > 0 && selectedIds.length === visibleIds.length;

  const toggleAll = useCallback(() => {
    setChecked(allSelected ? new Set() : new Set(visibleIds));
  }, [allSelected, visibleIds]);

  const reset = useCallback((ids: string[] = []) => setChecked(new Set(ids)), []);

  return {
    selectedIds,
    isSelected: (id: string) => checked.has(id),
    toggle,
    toggleAll,
    reset,
  };
}

/** 항목별 작업을 순차 실행하고 성공/실패 id 를 나눠 반환한다 (서버 동시 요청 폭주 방지). */
export async function runSequentially(
  ids: string[],
  task: (id: string) => Promise<unknown>,
  logTag: string,
): Promise<{ okIds: string[]; failedIds: string[] }> {
  const okIds: string[] = [];
  const failedIds: string[] = [];
  for (const id of ids) {
    try {
      await task(id);
      okIds.push(id);
    } catch (error) {
      console.error(`[${logTag}] 일괄 작업 실패`, id, error);
      failedIds.push(id);
    }
  }
  return { okIds, failedIds };
}
