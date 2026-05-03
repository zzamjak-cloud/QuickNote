import { ArrowUpRight, PanelRight } from "lucide-react";
import type {
  DatabasePanelState,
  DatabaseRowView,
  ColumnDef,
} from "../../../types/database";
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

export function DatabaseTimelineView({
  databaseId,
  panelState,
  setPanelState,
}: Props) {
  const { bundle, rows, columns } = useProcessedRows(databaseId, panelState);
  const addRow = useDatabaseStore((s) => s.addRow);

  const dateCols = columns.filter((c) => c.type === "date");
  const dateColId =
    panelState.timelineDateColumnId ?? dateCols[0]?.id ?? null;

  if (!bundle) return null;

  const sorted = [...rows].sort((a, b) => {
    const da = parseDate(a.cells[dateColId ?? ""]);
    const db = parseDate(b.cells[dateColId ?? ""]);
    return da - db;
  });

  return (
    <div className="min-w-[320px]">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-zinc-600 dark:text-zinc-400">날짜 속성</span>
        <select
          value={dateColId ?? ""}
          onChange={(e) =>
            setPanelState({
              timelineDateColumnId: e.target.value || null,
            })
          }
          className="rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-600 dark:bg-zinc-900"
        >
          <option value="">선택…</option>
          {dateCols.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      {!dateColId ? (
        <p className="py-6 text-center text-xs text-zinc-500">
          날짜 타입 속성을 추가한 뒤 타임라인 축으로 지정하세요.
        </p>
      ) : (
        <div className="relative border-l-2 border-zinc-200 pl-4 dark:border-zinc-700">
          {sorted.map((row) => (
            <TimelineRow
              key={row.pageId}
              databaseId={databaseId}
              row={row}
              columns={columns}
              dateColId={dateColId}
            />
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => addRow(databaseId)}
        className="mt-3 rounded-md px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        + 새 항목
      </button>
    </div>
  );
}

function parseDate(cell: unknown): number {
  if (
    cell &&
    typeof cell === "object" &&
    !Array.isArray(cell) &&
    "start" in cell &&
    typeof (cell as { start?: string }).start === "string"
  ) {
    const t = Date.parse((cell as { start: string }).start);
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
}

function formatDate(cell: unknown): string {
  if (
    cell &&
    typeof cell === "object" &&
    !Array.isArray(cell) &&
    "start" in cell &&
    typeof (cell as { start?: string }).start === "string"
  ) {
    const s = (cell as { start?: string; end?: string }).start?.slice(0, 10);
    const e = (cell as { end?: string }).end?.slice(0, 10);
    if (s && e && s !== e) return `${s} ~ ${e}`;
    return s ?? "";
  }
  return "";
}

function TimelineRow({
  databaseId,
  row,
  columns,
  dateColId,
}: {
  databaseId: string;
  row: DatabaseRowView;
  columns: ColumnDef[];
  dateColId: string;
}) {
  const titleCol = columns.find((c) => c.type === "title");
  const setActivePage = usePageStore((s) => s.setActivePage);
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);
  const openPeek = useUiStore((s) => s.openPeek);

  const openFull = () => {
    setActivePage(row.pageId);
    setCurrentTabPage(row.pageId);
  };

  return (
    <div className="group relative mb-6">
      <div className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-blue-500 ring-4 ring-white dark:ring-zinc-950" />
      <div className="text-[10px] font-medium text-blue-600 dark:text-blue-400">
        {formatDate(row.cells[dateColId]) || "날짜 없음"}
      </div>
      <div className="mt-1 rounded-lg border border-zinc-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-900">
        <div className="mb-2 flex items-center justify-between gap-1">
          {titleCol ? (
            <div className="min-w-0 flex-1 font-medium text-zinc-900 dark:text-zinc-100">
              <DatabaseCell
                databaseId={databaseId}
                rowId={row.pageId}
                column={titleCol}
                value={row.title}
              />
            </div>
          ) : (
            <span className="min-w-0 flex-1 text-xs text-zinc-500">제목 없음</span>
          )}
          <div className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100">
            <button
              type="button"
              onClick={openFull}
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
        <div className="flex flex-wrap gap-3">
          {columns
            .filter((c) => c.id !== titleCol?.id && c.id !== dateColId)
            .map((col) => (
              <div key={col.id} className="min-w-[100px]">
                <div className="text-[10px] text-zinc-400">{col.name}</div>
                <DatabaseCell
                  databaseId={databaseId}
                  rowId={row.pageId}
                  column={col}
                  value={row.cells[col.id]}
                />
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
