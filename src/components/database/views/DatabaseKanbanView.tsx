import { useState } from "react";
import { ArrowUpRight, PanelRight, Plus } from "lucide-react";
import type {
  ColumnDef,
  DatabasePanelState,
  DatabaseRowView,
} from "../../../types/database";
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

const DRAG_MIME = "application/x-quicknote-db-drag";
const UNCATEGORIZED = "__none__";

/** 16진 컬러를 옅은 RGBA로(카드 배경용). */
function hexToRgba(hex: string | undefined, alpha: number): string {
  if (!hex) return `rgba(148, 163, 184, ${alpha})`;
  const m = /^#?([\da-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function DatabaseKanbanView({
  databaseId,
  panelState,
  setPanelState,
}: Props) {
  const { bundle, rows, columns } = useProcessedRows(databaseId, panelState);
  const addRow = useDatabaseStore((s) => s.addRow);
  const updateCell = useDatabaseStore((s) => s.updateCell);
  const setActivePage = usePageStore((s) => s.setActivePage);
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);
  const openPeek = useUiStore((s) => s.openPeek);

  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  if (!bundle) return null;

  // 그룹 컬럼: panelState 우선 → 첫 status → 첫 select.
  const selectableCols = columns.filter(
    (c) => c.type === "status" || c.type === "select",
  );
  const statusFirst = columns.find((c) => c.type === "status");
  const selectFirst = columns.find((c) => c.type === "select");
  const groupColId =
    panelState.kanbanGroupColumnId ?? statusFirst?.id ?? selectFirst?.id ?? null;
  const groupCol: ColumnDef | undefined = columns.find((c) => c.id === groupColId);
  const options = groupCol?.config?.options ?? [];

  // 카드에 표시할 속성 (#7) — viewConfigs.kanban 우선, 없으면 title 외 첫 2개.
  const visibleCardCols = (() => {
    const v = getVisibleOrderedColumns(columns, "kanban", panelState.viewConfigs);
    if (panelState.viewConfigs?.kanban?.visibleColumnIds) {
      return v.filter((c) => c.type !== "title");
    }
    return columns.filter((c) => c.type !== "title").slice(0, 2);
  })();

  // 버킷 구성
  const buckets = new Map<string, DatabaseRowView[]>();
  for (const o of options) buckets.set(o.id, []);
  buckets.set(UNCATEGORIZED, []);
  for (const row of rows) {
    const raw = row.cells[groupColId ?? ""];
    const key =
      typeof raw === "string" && raw && buckets.has(raw) ? raw : UNCATEGORIZED;
    buckets.get(key)!.push(row);
  }

  const openFull = (pageId: string) => {
    setActivePage(pageId);
    setCurrentTabPage(pageId);
  };

  // 드롭 처리: 카드 → 다른 컬럼 = 그룹 컬럼 셀 값 변경
  const onDropToColumn = (e: React.DragEvent, colKey: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverCol(null);
    if (!groupColId || !groupCol) return;
    const data = e.dataTransfer.getData(DRAG_MIME);
    if (!data?.startsWith("kanban:")) return;
    const pageId = data.slice("kanban:".length);
    const newVal = colKey === UNCATEGORIZED ? null : colKey;
    updateCell(databaseId, pageId, groupColId, newVal);
  };

  return (
    <div>
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
        <div className="ml-auto">
          <DatabaseColumnSettingsButton
            databaseId={databaseId}
            viewKind="kanban"
            panelState={panelState}
            setPanelState={setPanelState}
          />
        </div>
      </div>
      {!groupCol ? (
        <p className="py-6 text-center text-xs text-zinc-500">
          상태 또는 선택 타입 속성을 추가한 뒤 그룹 컬럼을 지정하세요.
        </p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {[
            ...options.map((o) => ({
              id: o.id,
              label: o.label,
              color: o.color,
            })),
            { id: UNCATEGORIZED, label: "미지정", color: "#94a3b8" },
          ].map((col) => {
            const bucketRows = buckets.get(col.id) ?? [];
            const isDropOver = dragOverCol === col.id;
            return (
              <div
                key={col.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOverCol(col.id);
                }}
                onDragLeave={(e) => {
                  e.stopPropagation();
                  setDragOverCol((cur) => (cur === col.id ? null : cur));
                }}
                onDrop={(e) => onDropToColumn(e, col.id)}
                className={[
                  "flex w-[260px] shrink-0 flex-col rounded-lg bg-zinc-50 dark:bg-zinc-900/60",
                  isDropOver
                    ? "border-2 border-dashed border-blue-400 ring-2 ring-blue-300/30"
                    : "border border-zinc-200 dark:border-zinc-700",
                ].join(" ")}
              >
                <div
                  className="flex items-center justify-between gap-2 rounded-t-lg px-2 py-1.5 text-[11px] font-medium"
                  style={{
                    backgroundColor: hexToRgba(col.color, 0.18),
                    color: "inherit",
                  }}
                >
                  <span className="flex items-center gap-1.5 truncate">
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: col.color ?? "#94a3b8" }}
                    />
                    <span className="truncate">{col.label}</span>
                  </span>
                  <span className="shrink-0 text-zinc-500 dark:text-zinc-400">
                    {bucketRows.length}
                  </span>
                </div>
                <div className="flex-1 space-y-2 p-2">
                  {bucketRows.map((row) => (
                    <KanbanCard
                      key={row.pageId}
                      row={row}
                      databaseId={databaseId}
                      visibleCardCols={visibleCardCols}
                      colColor={col.color}
                      onOpenFull={() => openFull(row.pageId)}
                      onOpenPeek={() => openPeek(row.pageId)}
                    />
                  ))}
                  {bucketRows.length === 0 && (
                    <div className="rounded border border-dashed border-zinc-200 px-2 py-3 text-center text-[10px] text-zinc-400 dark:border-zinc-700">
                      비어 있음
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
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

function KanbanCard({
  row,
  databaseId,
  visibleCardCols,
  colColor,
  onOpenFull,
  onOpenPeek,
}: {
  row: DatabaseRowView;
  databaseId: string;
  visibleCardCols: ColumnDef[];
  colColor: string | undefined;
  onOpenFull: () => void;
  onOpenPeek: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(DRAG_MIME, `kanban:${row.pageId}`);
      }}
      onDragEnd={(e) => e.stopPropagation()}
      className="group relative cursor-grab rounded-md border border-zinc-200 bg-white p-2 shadow-sm hover:shadow-md active:cursor-grabbing dark:border-zinc-700 dark:bg-zinc-950"
      style={{
        borderLeft: `4px solid ${colColor ?? "#94a3b8"}`,
      }}
    >
      <div className="mb-1 flex items-start justify-between gap-1">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {row.title || "제목 없음"}
        </span>
        <div className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100">
          <button
            type="button"
            onClick={onOpenFull}
            title="페이지로 열기"
            className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
          >
            <ArrowUpRight size={11} />
          </button>
          <button
            type="button"
            onClick={onOpenPeek}
            title="사이드 피크 열기"
            className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
          >
            <PanelRight size={11} />
          </button>
        </div>
      </div>
      {visibleCardCols.length > 0 && (
        <div className="space-y-1">
          {visibleCardCols.map((c) => (
            <div key={c.id} className="flex items-baseline gap-1">
              <span className="shrink-0 text-[9px] uppercase text-zinc-400">
                {c.name}
              </span>
              <div className="min-w-0 flex-1 truncate text-[11px]">
                <DatabaseCell
                  databaseId={databaseId}
                  rowId={row.pageId}
                  column={c}
                  value={row.cells[c.id]}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
