import { Plus, ArrowUpRight, PanelRight } from "lucide-react";
import type { DatabasePanelState } from "../../../types/database";
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

export function DatabaseListView({ databaseId, panelState }: Props) {
  const { bundle, rows, columns } = useProcessedRows(databaseId, panelState);
  const addRow = useDatabaseStore((s) => s.addRow);
  const setActivePage = usePageStore((s) => s.setActivePage);
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);
  const openPeek = useUiStore((s) => s.openPeek);

  if (!bundle) return null;

  const titleCol = columns.find((c) => c.type === "title");

  const openFull = (pageId: string) => {
    setActivePage(pageId);
    setCurrentTabPage(pageId);
  };

  return (
    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
      {rows.map((row) => (
        <li
          key={row.pageId}
          className="group flex flex-wrap items-start gap-3 py-2"
        >
          <div className="min-w-[140px] flex-1 font-medium text-zinc-900 dark:text-zinc-100">
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
          <div className="flex flex-1 flex-wrap gap-x-4 gap-y-1">
            {columns
              .filter((c) => c.id !== titleCol?.id)
              .map((col) => (
                <div key={col.id} className="min-w-[100px] text-xs">
                  <span className="text-[10px] text-zinc-400">{col.name}</span>
                  <DatabaseCell
                    databaseId={databaseId}
                    rowId={row.pageId}
                    column={col}
                    value={row.cells[col.id]}
                  />
                </div>
              ))}
          </div>
          <div className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100">
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
      <li className="pt-2">
        <button
          type="button"
          onClick={() => addRow(databaseId)}
          className="flex items-center gap-1 text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-400"
        >
          <Plus size={14} /> 새 항목
        </button>
      </li>
    </ul>
  );
}
