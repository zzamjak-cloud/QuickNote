import { ArrowUpRight, PanelRight } from "lucide-react";
import type { DatabasePanelState, DatabaseRowView } from "../../../types/database";
import { useDatabaseStore } from "../../../store/databaseStore";
import { useProcessedRows } from "../useProcessedRows";
import { DatabaseCell } from "../DatabaseCell";
import { usePageStore } from "../../../store/pageStore";
import { useSettingsStore } from "../../../store/settingsStore";
import { useUiStore } from "../../../store/uiStore";

type Props = {
  databaseId: string;
  panelState: DatabasePanelState;
  setPanelState: (p: Partial<DatabasePanelState>) => void;
};

export function DatabaseKanbanView({
  databaseId,
  panelState,
  setPanelState,
}: Props) {
  const { bundle, rows, columns } = useProcessedRows(databaseId, panelState);
  const addRow = useDatabaseStore((s) => s.addRow);
  const setActivePage = usePageStore((s) => s.setActivePage);
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);
  const openPeek = useUiStore((s) => s.openPeek);

  if (!bundle) return null;

  const selectableCols = columns.filter(
    (c) => c.type === "select" || c.type === "status",
  );
  const groupColId =
    panelState.kanbanGroupColumnId ??
    selectableCols[0]?.id ??
    null;
  const groupCol = columns.find((c) => c.id === groupColId);

  const options = groupCol?.config?.options ?? [];
  const uncategorized = "__none__";

  const buckets = new Map<string, DatabaseRowView[]>();
  for (const o of options) {
    buckets.set(o.id, []);
  }
  buckets.set(uncategorized, []);

  for (const row of rows) {
    const raw = row.cells[groupColId ?? ""];
    const key =
      typeof raw === "string" && raw && buckets.has(raw)
        ? raw
        : uncategorized;
    const list = buckets.get(key) ?? buckets.get(uncategorized)!;
    list.push(row);
  }

  const openFull = (pageId: string) => {
    setActivePage(pageId);
    setCurrentTabPage(pageId);
  };

  return (
    <div className="min-w-[640px]">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-zinc-600 dark:text-zinc-400">그룹 컬럼</span>
        <select
          value={groupColId ?? ""}
          onChange={(e) =>
            setPanelState({
              kanbanGroupColumnId: e.target.value || null,
            })
          }
          className="rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-600 dark:bg-zinc-900"
        >
          <option value="">선택…</option>
          {selectableCols.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      {!groupCol ? (
        <p className="py-6 text-center text-xs text-zinc-500">
          선택 또는 상태 타입 속성을 추가한 뒤 그룹 컬럼을 지정하세요.
        </p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-2">
          {[...options.map((o) => ({ id: o.id, label: o.label })), { id: uncategorized, label: "미분류" }].map(
            (col) => (
              <div
                key={col.id}
                className="min-w-[200px] flex-1 rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"
              >
                <div className="border-b border-zinc-100 px-2 py-1 text-[11px] font-medium text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
                  {col.label}{" "}
                  <span className="text-zinc-400">
                    ({(buckets.get(col.id) ?? []).length})
                  </span>
                </div>
                <div className="space-y-2 p-2">
                  {(buckets.get(col.id) ?? []).map((row) => (
                    <div
                      key={row.pageId}
                      className="group rounded-md border border-zinc-100 bg-zinc-50 p-2 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
                    >
                      <div className="mb-1 flex items-center justify-between gap-1">
                        <span className="truncate text-xs font-medium text-zinc-900 dark:text-zinc-100">
                          {row.title || "제목 없음"}
                        </span>
                        <div className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => openFull(row.pageId)}
                            title="페이지로 열기"
                            className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
                          >
                            <ArrowUpRight size={11} />
                          </button>
                          <button
                            type="button"
                            onClick={() => openPeek(row.pageId)}
                            title="사이드 피크 열기"
                            className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
                          >
                            <PanelRight size={11} />
                          </button>
                        </div>
                      </div>
                      {columns
                        .filter((c) => c.type !== "title")
                        .slice(0, 3)
                        .map((c) => (
                          <div key={c.id} className="mb-1">
                            <div className="text-[10px] text-zinc-400">{c.name}</div>
                            <DatabaseCell
                              databaseId={databaseId}
                              rowId={row.pageId}
                              column={c}
                              value={row.cells[c.id]}
                            />
                          </div>
                        ))}
                    </div>
                  ))}
                </div>
              </div>
            ),
          )}
        </div>
      )}
      <button
        type="button"
        onClick={() => addRow(databaseId)}
        className="mt-2 rounded-md px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        + 새 항목
      </button>
    </div>
  );
}
