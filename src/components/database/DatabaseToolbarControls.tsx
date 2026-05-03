import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { newId } from "../../lib/id";
import { FILTER_OPERATORS } from "../../lib/databaseQuery";
import type {
  DatabasePanelState,
  FilterRule,
  FilterOperator,
  SortRule,
} from "../../types/database";
import { useDatabaseStore } from "../../store/databaseStore";

type Props = {
  databaseId: string;
  panelState: DatabasePanelState;
  setPanelState: (p: Partial<DatabasePanelState>) => void;
};

export function DatabaseToolbarControls({
  databaseId,
  panelState,
  setPanelState,
}: Props) {
  const bundle = useDatabaseStore((s) => s.databases[databaseId]);
  const [filterExpanded, setFilterExpanded] = useState(false);
  const [sortExpanded, setSortExpanded] = useState(false);

  // 검색창 — 한글 IME 입력 깨짐 방지(#3): composition 동안 panelState commit 보류.
  const [searchDraft, setSearchDraft] = useState(panelState.searchQuery);
  const composingRef = useRef(false);
  useEffect(() => {
    // 외부에서 panelState가 바뀌면(다른 인스턴스 등) draft 동기화.
    if (!composingRef.current) setSearchDraft(panelState.searchQuery);
  }, [panelState.searchQuery]);

  const sortOptions = useMemo(() => {
    const cols = bundle?.columns ?? [];
    return cols.map((c) => (
      <option key={c.id} value={c.id}>
        {c.name}
      </option>
    ));
  }, [bundle]);

  const columns = bundle?.columns ?? [];
  // 구버전 sortColumnId 마이그레이션: sortRules가 비어 있고 sortColumnId가 있으면 한 번 채워서 보여줌.
  const effectiveSortRules: SortRule[] =
    panelState.sortRules && panelState.sortRules.length > 0
      ? panelState.sortRules
      : panelState.sortColumnId
        ? [{ columnId: panelState.sortColumnId, dir: panelState.sortDir }]
        : [];

  const addFilter = () => {
    const first = columns[0];
    if (!first) return;
    const rule: FilterRule = {
      id: newId(),
      columnId: first.id,
      operator: "contains",
      value: "",
    };
    setPanelState({
      filterRules: [...panelState.filterRules, rule],
    });
    setFilterExpanded(true);
  };

  const updateRule = (id: string, patch: Partial<FilterRule>) => {
    setPanelState({
      filterRules: panelState.filterRules.map((r) =>
        r.id === id ? { ...r, ...patch } : r,
      ),
    });
  };

  const removeRule = (id: string) => {
    setPanelState({
      filterRules: panelState.filterRules.filter((r) => r.id !== id),
    });
  };

  // 다중 정렬(#4)
  const addSort = () => {
    // 이미 사용 중이지 않은 첫 컬럼을 기본 선택.
    const used = new Set(effectiveSortRules.map((r) => r.columnId));
    const first = columns.find((c) => !used.has(c.id)) ?? columns[0];
    if (!first) return;
    const next: SortRule[] = [...effectiveSortRules, { columnId: first.id, dir: "asc" }];
    setPanelState({ sortRules: next, sortColumnId: null });
    setSortExpanded(true);
  };

  const updateSortRule = (idx: number, patch: Partial<SortRule>) => {
    const next = effectiveSortRules.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    setPanelState({ sortRules: next, sortColumnId: null });
  };

  const removeSortRule = (idx: number) => {
    const next = effectiveSortRules.filter((_, i) => i !== idx);
    setPanelState({ sortRules: next, sortColumnId: null });
  };

  return (
    <div className="select-none border-b border-zinc-200 px-2 py-2 dark:border-zinc-700">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="검색…"
          value={searchDraft}
          onChange={(e) => {
            setSearchDraft(e.target.value);
            // composition 중에는 panelState commit 보류.
            if (!composingRef.current) {
              setPanelState({ searchQuery: e.target.value });
            }
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(e) => {
            composingRef.current = false;
            setPanelState({
              searchQuery: (e.target as HTMLInputElement).value,
            });
          }}
          className="w-44 select-text rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-600 dark:bg-zinc-900"
        />

        {/* 정렬 — 다중 규칙 (#4) */}
        <div className="inline-flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-600">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={addSort}
            className="flex items-center gap-1 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <Plus size={12} /> 정렬
            {effectiveSortRules.length > 0 && (
              <span className="ml-1 rounded bg-zinc-200 px-1 text-[10px] text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
                {effectiveSortRules.length}
              </span>
            )}
          </button>
          {effectiveSortRules.length > 0 && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setSortExpanded((v) => !v)}
              title={sortExpanded ? "정렬 접기" : "정렬 펼치기"}
              className="flex items-center border-l border-zinc-300 px-1.5 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800"
            >
              {sortExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          )}
        </div>

        {/* 필터 */}
        <div className="inline-flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-600">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={addFilter}
            className="flex items-center gap-1 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <Plus size={12} /> 필터
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setFilterExpanded((v) => !v)}
            title={filterExpanded ? "조건 접기" : "조건 펼치기"}
            className="flex items-center border-l border-zinc-300 px-1.5 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800"
          >
            {filterExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>
      </div>

      {sortExpanded && effectiveSortRules.length > 0 && (
        <div className="mt-2 space-y-1 border-t border-zinc-100 pt-2 dark:border-zinc-800">
          {effectiveSortRules.map((rule, idx) => (
            <div key={`${rule.columnId}:${idx}`} className="flex flex-wrap items-center gap-1 text-xs">
              <span className="text-[10px] text-zinc-400">{idx === 0 ? "1차" : `${idx + 1}차`}</span>
              <select
                value={rule.columnId}
                onChange={(e) => updateSortRule(idx, { columnId: e.target.value })}
                className="rounded border border-zinc-300 bg-white px-1 py-0.5 dark:border-zinc-600 dark:bg-zinc-900"
              >
                {sortOptions}
              </select>
              <button
                type="button"
                onClick={() =>
                  updateSortRule(idx, { dir: rule.dir === "asc" ? "desc" : "asc" })
                }
                className="rounded border border-zinc-300 px-1 dark:border-zinc-600"
                title={rule.dir === "asc" ? "오름차순" : "내림차순"}
              >
                {rule.dir === "asc" ? "↑" : "↓"}
              </button>
              <button
                type="button"
                onClick={() => removeSortRule(idx)}
                title="정렬 규칙 삭제"
                className="rounded p-0.5 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {filterExpanded && panelState.filterRules.length > 0 && (
        <div className="mt-2 space-y-1 border-t border-zinc-100 pt-2 dark:border-zinc-800">
          {panelState.filterRules.map((rule) => (
            <div key={rule.id} className="flex flex-wrap items-center gap-1 text-xs">
              <select
                value={rule.columnId}
                onChange={(e) =>
                  updateRule(rule.id, { columnId: e.target.value })
                }
                className="rounded border border-zinc-300 bg-white px-1 py-0.5 dark:border-zinc-600 dark:bg-zinc-900"
              >
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                value={rule.operator}
                onChange={(e) =>
                  updateRule(rule.id, {
                    operator: e.target.value as FilterOperator,
                  })
                }
                className="rounded border border-zinc-300 bg-white px-1 py-0.5 dark:border-zinc-600 dark:bg-zinc-900"
              >
                {FILTER_OPERATORS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
              {!["isEmpty", "isNotEmpty"].includes(rule.operator) && (
                <input
                  value={rule.value ?? ""}
                  onChange={(e) =>
                    updateRule(rule.id, { value: e.target.value })
                  }
                  className="min-w-[80px] flex-1 select-text rounded border border-zinc-300 px-1 py-0.5 dark:border-zinc-600 dark:bg-zinc-900"
                  placeholder="값"
                />
              )}
              <button
                type="button"
                className="text-red-600 hover:underline"
                onClick={() => removeRule(rule.id)}
              >
                삭제
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
