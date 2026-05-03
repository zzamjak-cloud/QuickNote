import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Plus } from "lucide-react";
import { newId } from "../../lib/id";
import { FILTER_OPERATORS } from "../../lib/databaseQuery";
import type {
  DatabasePanelState,
  FilterRule,
  FilterOperator,
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

  const sortOptions = useMemo(() => {
    const cols = bundle?.columns ?? [];
    return cols.map((c) => (
      <option key={c.id} value={c.id}>
        {c.name}
      </option>
    ));
  }, [bundle]);

  const columns = bundle?.columns ?? [];

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

  return (
    <div className="select-none border-b border-zinc-200 px-2 py-2 dark:border-zinc-700">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="검색…"
          value={panelState.searchQuery}
          onChange={(e) => setPanelState({ searchQuery: e.target.value })}
          className="min-w-[140px] flex-1 select-text rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-600 dark:bg-zinc-900"
        />
        <div className="flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-400">
          <span>정렬</span>
          <select
            value={panelState.sortColumnId ?? ""}
            onChange={(e) =>
              setPanelState({
                sortColumnId: e.target.value || null,
              })
            }
            className="rounded border border-zinc-300 bg-white px-1 py-0.5 dark:border-zinc-600 dark:bg-zinc-900"
          >
            <option value="">없음</option>
            {sortOptions}
          </select>
          <button
            type="button"
            className="rounded border border-zinc-300 px-1 dark:border-zinc-600"
            onClick={() =>
              setPanelState({
                sortDir: panelState.sortDir === "asc" ? "desc" : "asc",
              })
            }
          >
            {panelState.sortDir === "asc" ? "↑" : "↓"}
          </button>
        </div>
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
