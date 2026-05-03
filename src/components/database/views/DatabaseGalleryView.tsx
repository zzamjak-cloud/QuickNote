import { useEffect, useState } from "react";
import { ArrowUpRight, PanelRight } from "lucide-react";
import type {
  DatabasePanelState,
  DatabaseRowView,
  ColumnDef,
  FileCellItem,
} from "../../../types/database";
import { useDatabaseStore } from "../../../store/databaseStore";
import { useProcessedRows } from "../useProcessedRows";
import { DatabaseCell } from "../DatabaseCell";
import { getDatabaseFile } from "../../../lib/databaseFileStorage";
import { usePageStore } from "../../../store/pageStore";
import { useSettingsStore } from "../../../store/settingsStore";
import { useUiStore } from "../../../store/uiStore";

type Props = {
  databaseId: string;
  panelState: DatabasePanelState;
  setPanelState: (p: Partial<DatabasePanelState>) => void;
};

export function DatabaseGalleryView({
  databaseId,
  panelState,
  setPanelState,
}: Props) {
  const { bundle, rows, columns } = useProcessedRows(databaseId, panelState);
  const addRow = useDatabaseStore((s) => s.addRow);

  const coverCandidates = columns.filter(
    (c) => c.type === "file" || c.type === "url",
  );
  const coverColId =
    panelState.galleryCoverColumnId ?? coverCandidates[0]?.id ?? null;

  if (!bundle) return null;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-zinc-600 dark:text-zinc-400">커버</span>
        <select
          value={coverColId ?? ""}
          onChange={(e) =>
            setPanelState({
              galleryCoverColumnId: e.target.value || null,
            })
          }
          className="rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-600 dark:bg-zinc-900"
        >
          <option value="">없음</option>
          {coverCandidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {rows.map((row) => (
          <GalleryCard
            key={row.pageId}
            databaseId={databaseId}
            row={row}
            columns={columns}
            coverColumn={columns.find((c) => c.id === coverColId)}
          />
        ))}
      </div>
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

function GalleryCard({
  databaseId,
  row,
  columns,
  coverColumn,
}: {
  databaseId: string;
  row: DatabaseRowView;
  columns: ColumnDef[];
  coverColumn?: ColumnDef;
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
    <div className="group overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <CoverImage column={coverColumn} cell={row.cells[coverColumn?.id ?? ""]} />
      <div className="p-2">
        <div className="flex items-center justify-between gap-1">
          <div className="truncate text-xs font-medium text-zinc-900 dark:text-zinc-100">
            {row.title || "제목 없음"}
          </div>
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
        {columns
          .filter((c) => c.id !== titleCol?.id && c.id !== coverColumn?.id)
          .slice(0, 2)
          .map((c) => (
            <div key={c.id} className="mt-1">
              <DatabaseCell
                databaseId={databaseId}
                rowId={row.pageId}
                column={c}
                value={row.cells[c.id]}
              />
            </div>
          ))}
      </div>
    </div>
  );
}

function CoverImage({
  column,
  cell,
}: {
  column?: ColumnDef;
  cell: import("../../../types/database").CellValue;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let revoked: string | null = null;
    if (!column) {
      setSrc(null);
      return;
    }
    if (column.type === "url" && typeof cell === "string" && cell) {
      setSrc(cell);
      return () => {
        if (revoked) URL.revokeObjectURL(revoked);
      };
    }
    if (column.type === "file" && Array.isArray(cell) && cell.length > 0) {
      const first = cell[0] as FileCellItem;
      void getDatabaseFile(first.fileId).then((blob) => {
        if (blob && blob.type.startsWith("image/")) {
          const u = URL.createObjectURL(blob);
          revoked = u;
          setSrc(u);
        } else {
          setSrc(null);
        }
      });
    } else {
      setSrc(null);
    }
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [column, cell]);

  if (!src) {
    return (
      <div className="flex aspect-video items-center justify-center bg-zinc-100 text-[10px] text-zinc-400 dark:bg-zinc-800">
        미리보기
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      className="aspect-video w-full object-cover"
    />
  );
}
