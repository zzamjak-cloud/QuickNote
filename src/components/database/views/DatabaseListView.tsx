import { Plus, ArrowUpRight, PanelRight } from "lucide-react";
import type { DatabasePanelState } from "../../../types/database";
import { getVisibleOrderedColumns } from "../../../types/database";
import { useDatabaseStore } from "../../../store/databaseStore";
import { useProcessedRows } from "../useProcessedRows";
import { DatabaseCell } from "../DatabaseCell";
import { DatabaseColumnSettingsButton } from "../DatabaseColumnSettingsButton";
import { usePageStore } from "../../../store/pageStore";
import { useSettingsStore } from "../../../store/settingsStore";
import { useUiStore } from "../../../store/uiStore";

type Props = {
  databaseId: string;
  panelState: DatabasePanelState;
  setPanelState: (p: Partial<DatabasePanelState>) => void;
};

export function DatabaseListView({
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

  const titleCol = columns.find((c) => c.type === "title");

  // viewConfigs.list 우선, 없으면 title 외 처음 3개 (#8)
  const visibleAttrCols = (() => {
    const v = getVisibleOrderedColumns(columns, "list", panelState.viewConfigs);
    if (panelState.viewConfigs?.list?.visibleColumnIds) {
      return v.filter((c) => c.id !== titleCol?.id);
    }
    return columns.filter((c) => c.id !== titleCol?.id).slice(0, 3);
  })();

  const openFull = (pageId: string) => {
    setActivePage(pageId);
    setCurrentTabPage(pageId);
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-end">
        <DatabaseColumnSettingsButton
          databaseId={databaseId}
          viewKind="list"
          panelState={panelState}
          setPanelState={setPanelState}
        />
      </div>
      <div className="overflow-x-auto">
        <ul className="min-w-full divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map((row) => (
            <li
              key={row.pageId}
              className="group flex items-center gap-3 whitespace-nowrap py-1.5"
            >
              <div className="min-w-[160px] flex-1 truncate text-xs font-medium text-zinc-900 dark:text-zinc-100">
                {titleCol ? (
                  <DatabaseCell
                    databaseId={databaseId}
                    rowId={row.pageId}
                    column={titleCol}
                    value={row.title}
                  />
                ) : (
                  row.pageId.slice(0, 8)
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {visibleAttrCols.map((col) => (
                  <div
                    key={col.id}
                    className="flex w-[140px] shrink-0 items-center gap-1 truncate text-[11px]"
                  >
                    <span className="shrink-0 text-[9px] uppercase text-zinc-400">
                      {col.name}
                    </span>
                    <div className="min-w-0 flex-1 truncate">
                      <DatabaseCell
                        databaseId={databaseId}
                        rowId={row.pageId}
                        column={col}
                        value={row.cells[col.id]}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => openFull(row.pageId)}
                  title="페이지로 열기"
                  className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
                >
                  <ArrowUpRight size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => openPeek(row.pageId)}
                  title="사이드 피크 열기"
                  className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
                >
                  <PanelRight size={12} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        onClick={() => addRow(databaseId)}
        className="mt-2 flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        <Plus size={14} /> 새 항목
      </button>
    </div>
  );
}
