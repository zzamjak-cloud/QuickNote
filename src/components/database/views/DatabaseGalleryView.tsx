import { useEffect, useState } from "react";
import type { JSONContent } from "@tiptap/react";
import { ArrowUpRight, PanelRight, X } from "lucide-react";
import type {
  DatabasePanelState,
  DatabaseRowView,
  ColumnDef,
  FileCellItem,
} from "../../../types/database";
import { useDatabaseStore } from "../../../store/databaseStore";
import { useProcessedRows } from "../useProcessedRows";
import { DatabaseCell } from "../DatabaseCell";
import { getVisibleOrderedColumns } from "../../../types/database";
import { getDatabaseFile } from "../../../lib/databaseFileStorage";
import { usePageStore } from "../../../store/pageStore";
import { IconPicker } from "../../common/IconPicker";
import { useSettingsStore } from "../../../store/settingsStore";
import { useUiStore } from "../../../store/uiStore";
import { SimpleConfirmDialog } from "../../ui/SimpleConfirmDialog";

type Props = {
  databaseId: string;
  panelState: DatabasePanelState;
  setPanelState: (p: Partial<DatabasePanelState>) => void;
  /** 표시할 최대 행 수. 미지정 시 전체 표시. */
  visibleRowLimit?: number;
};

/** 페이지 doc(JSONContent)에서 첫 이미지 src를 깊이우선으로 탐색. */
function findFirstImageSrc(doc: JSONContent | undefined): string | null {
  if (!doc) return null;
  const visit = (node: JSONContent | undefined): string | null => {
    if (!node) return null;
    if (node.type === "image" || node.type === "imageBlock") {
      const src = (node.attrs?.src ?? "") as string;
      if (typeof src === "string" && src) return src;
    }
    const children = node.content;
    if (Array.isArray(children)) {
      for (const c of children) {
        const found = visit(c);
        if (found) return found;
      }
    }
    return null;
  };
  return visit(doc);
}

export function DatabaseGalleryView({
  databaseId,
  panelState,
  setPanelState,
  visibleRowLimit,
}: Props) {
  const { bundle, rows: allRows, columns } = useProcessedRows(databaseId, panelState);
  // 표시 제한이 있으면 slice 적용.
  const rows = visibleRowLimit != null ? allRows.slice(0, visibleRowLimit) : allRows;
  const addRow = useDatabaseStore((s) => s.addRow);
  const deleteRow = useDatabaseStore((s) => s.deleteRow);

  const [rowDeletePageId, setRowDeletePageId] = useState<string | null>(null);

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
          <option value="">페이지 본문 첫 이미지</option>
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
            visibleColumns={getVisibleOrderedColumns(
              columns,
              "gallery",
              panelState.viewConfigs,
            )}
            onRequestDelete={() => setRowDeletePageId(row.pageId)}
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
      <SimpleConfirmDialog
        open={rowDeletePageId !== null}
        title="행 삭제"
        message="이 행을 삭제할까요? (연결된 페이지도 삭제됩니다)"
        confirmLabel="삭제"
        danger
        onCancel={() => setRowDeletePageId(null)}
        onConfirm={() => {
          if (rowDeletePageId) deleteRow(databaseId, rowDeletePageId);
          setRowDeletePageId(null);
        }}
      />
    </div>
  );
}

function GalleryCard({
  databaseId,
  row,
  columns,
  coverColumn,
  visibleColumns,
  onRequestDelete,
}: {
  databaseId: string;
  row: DatabaseRowView;
  columns: ColumnDef[];
  coverColumn?: ColumnDef;
  visibleColumns: ColumnDef[];
  onRequestDelete: () => void;
}) {
  const titleCol = columns.find((c) => c.type === "title");
  // viewConfigs.gallery.visibleColumnIds가 명시돼 있으면 그 순서대로 모두 표시,
  // 미지정이면 title·cover 제외 첫 2개만 (기본값).
  const cardCols = (() => {
    const explicit = visibleColumns.filter(
      (c) => c.id !== titleCol?.id && c.id !== coverColumn?.id,
    );
    // viewConfigs가 지정되었으면 visibleColumns가 columns와 다를 가능성 있음 → 그대로 사용.
    // 미지정 시(=visibleColumns가 columns와 동일) 처음 2개로 제한.
    const allEqual =
      visibleColumns.length === columns.length &&
      visibleColumns.every((c, i) => c.id === columns[i]?.id);
    return allEqual ? explicit.slice(0, 2) : explicit;
  })();
  const pages = usePageStore((s) => s.pages);
  const setIcon = usePageStore((s) => s.setIcon);
  const setActivePage = usePageStore((s) => s.setActivePage);
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);
  const openPeek = useUiStore((s) => s.openPeek);
  // 행 페이지 doc에서 첫 이미지를 fallback 커버로 사용
  const pageDoc = usePageStore((s) => s.pages[row.pageId]?.doc);

  const openFull = () => {
    setActivePage(row.pageId);
    setCurrentTabPage(row.pageId);
  };

  return (
    <div className="group overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <CoverImage
        column={coverColumn}
        cell={row.cells[coverColumn?.id ?? ""]}
        pageDoc={pageDoc}
      />
      <div className="p-2">
        <div className="flex items-center justify-between gap-1">
          <div className="flex min-w-0 items-center gap-1 text-xs font-medium text-zinc-900 dark:text-zinc-100">
            <span className="shrink-0" onPointerDown={(e) => e.stopPropagation()}>
              <IconPicker current={pages[row.pageId]?.icon ?? null} size="sm" onChange={(icon) => setIcon(row.pageId, icon)} />
            </span>
            <span className="truncate">{row.title || "제목 없음"}</span>
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
            <button
              type="button"
              onClick={onRequestDelete}
              title="항목 삭제"
              className="rounded p-0.5 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
            >
              <X size={11} />
            </button>
          </div>
        </div>
        {cardCols.map((c) => (
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
  pageDoc,
}: {
  column?: ColumnDef;
  cell: import("../../../types/database").CellValue;
  pageDoc?: JSONContent;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;

    const setIfActive = (v: string | null) => {
      if (!cancelled) setSrc(v);
    };

    // 1) 명시 컬럼 (file 또는 url)
    if (column?.type === "url" && typeof cell === "string" && cell) {
      setIfActive(cell);
      return () => {
        cancelled = true;
        if (revoked) URL.revokeObjectURL(revoked);
      };
    }
    if (column?.type === "file" && Array.isArray(cell) && cell.length > 0) {
      const first = cell[0] as FileCellItem;
      void getDatabaseFile(first.fileId).then((blob) => {
        if (cancelled) return;
        if (blob && blob.type.startsWith("image/")) {
          const u = URL.createObjectURL(blob);
          revoked = u;
          setIfActive(u);
        } else {
          // file 컬럼이지만 이미지가 아니면 페이지 본문 fallback.
          setIfActive(findFirstImageSrc(pageDoc));
        }
      });
      return () => {
        cancelled = true;
        if (revoked) URL.revokeObjectURL(revoked);
      };
    }

    // 2) Fallback — 페이지 본문 첫 이미지
    setIfActive(findFirstImageSrc(pageDoc));
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [column, cell, pageDoc]);

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
