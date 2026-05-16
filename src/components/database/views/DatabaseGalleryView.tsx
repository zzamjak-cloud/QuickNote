import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { JSONContent } from "@tiptap/react";
import { Image } from "lucide-react";
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
import { useUiStore } from "../../../store/uiStore";

type Props = {
  databaseId: string;
  panelState: DatabasePanelState;
  setPanelState: (p: Partial<DatabasePanelState>) => void;
  /** 표시할 최대 행 수. 미지정 시 전체 표시. */
  visibleRowLimit?: number;
};

/** 페이지 doc(JSONContent)에서 모든 이미지 src를 깊이우선으로 수집. */
function findAllImageSrcs(doc: JSONContent | undefined): string[] {
  if (!doc) return [];
  const results: string[] = [];
  const visit = (node: JSONContent | undefined): void => {
    if (!node) return;
    if (node.type === "image" || node.type === "imageBlock") {
      const src = (node.attrs?.src ?? "") as string;
      if (typeof src === "string" && src) results.push(src);
    }
    const children = node.content;
    if (Array.isArray(children)) {
      for (const c of children) visit(c);
    }
  };
  visit(doc);
  return results;
}

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
  setPanelState: _setPanelState,
  visibleRowLimit,
}: Props) {
  const { bundle, rows: allRows, columns } = useProcessedRows(databaseId, panelState);
  // 표시 제한이 있으면 slice 적용.
  const rows = visibleRowLimit != null ? allRows.slice(0, visibleRowLimit) : allRows;
  const addRow = useDatabaseStore((s) => s.addRow);

  // 행별 커버 이미지 오버라이드 (세션 한정)
  const [coverOverrides, setCoverOverrides] = useState<Map<string, string>>(new Map());

  const coverCandidates = columns.filter(
    (c) => c.type === "file" || c.type === "url",
  );
  const coverColId =
    panelState.galleryCoverColumnId ?? coverCandidates[0]?.id ?? null;

  if (!bundle) return null;

  return (
    <div className="pt-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {rows.map((row) => (
          <GalleryCard
            key={row.pageId}
            databaseId={databaseId}
            row={row}
            columns={columns}
            coverColumn={columns.find((c) => c.id === coverColId)}
            coverSrcOverride={coverOverrides.get(row.pageId)}
            visibleColumns={getVisibleOrderedColumns(
              columns,
              "gallery",
              panelState.viewConfigs,
            )}
            onSetCoverSrc={(src) => {
              setCoverOverrides((prev) => {
                const next = new Map(prev);
                if (src) next.set(row.pageId, src);
                else next.delete(row.pageId);
                return next;
              });
            }}
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
  coverSrcOverride,
  visibleColumns,
  onSetCoverSrc,
}: {
  databaseId: string;
  row: DatabaseRowView;
  columns: ColumnDef[];
  coverColumn?: ColumnDef;
  coverSrcOverride?: string;
  visibleColumns: ColumnDef[];
  onSetCoverSrc?: (src: string | null) => void;
}) {
  const titleCol = columns.find((c) => c.type === "title");
  const cardCols = (() => {
    const explicit = visibleColumns.filter(
      (c) => c.id !== titleCol?.id && c.id !== coverColumn?.id,
    );
    const allEqual =
      visibleColumns.length === columns.length &&
      visibleColumns.every((c, i) => c.id === columns[i]?.id);
    return allEqual ? [] : explicit;
  })();
  const pages = usePageStore((s) => s.pages);
  const setIcon = usePageStore((s) => s.setIcon);
  const openPeek = useUiStore((s) => s.openPeek);
  const pageDoc = usePageStore((s) => s.pages[row.pageId]?.doc);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerBtnRef = useRef<HTMLButtonElement>(null);

  const imageSrcs = findAllImageSrcs(pageDoc);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openPeek(row.pageId)}
      onKeyDown={(e) => e.key === "Enter" && openPeek(row.pageId)}
      className="group w-full cursor-pointer overflow-hidden rounded-xl border border-zinc-200 bg-white text-left shadow-sm transition-shadow hover:shadow-md dark:border-zinc-700 dark:bg-zinc-900"
    >
      {/* 커버 영역 — 이미지 설정 버튼 오버레이 */}
      <div className="relative">
        <CoverImage
          column={coverColumn}
          cell={row.cells[coverColumn?.id ?? ""]}
          pageDoc={pageDoc}
          overrideSrc={coverSrcOverride}
        />
        <button
          ref={pickerBtnRef}
          type="button"
          onClick={(e) => { e.stopPropagation(); setPickerOpen((v) => !v); }}
          title="커버 이미지 설정"
          className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded bg-black/50 px-1.5 py-0.5 text-xs text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 hover:bg-black/70"
        >
          <Image size={11} />
          커버
        </button>
        {pickerOpen && createPortal(
          <CoverImagePicker
            anchorEl={pickerBtnRef.current}
            imageSrcs={imageSrcs}
            onSelect={(src) => { onSetCoverSrc?.(src); setPickerOpen(false); }}
            onClose={() => setPickerOpen(false)}
          />,
          document.body,
        )}
      </div>
      <div className="p-2">
        <div className="flex min-w-0 items-center gap-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
          <span className="shrink-0" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
            <IconPicker current={pages[row.pageId]?.icon ?? null} size="sm" onChange={(icon) => setIcon(row.pageId, icon)} />
          </span>
          <span className="truncate">{row.title || "제목 없음"}</span>
        </div>
        {cardCols.map((c) => (
          <div key={c.id} className="mt-1 text-sm">
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

function CoverImagePicker({
  anchorEl,
  imageSrcs,
  onSelect,
  onClose,
}: {
  anchorEl: HTMLElement | null;
  imageSrcs: string[];
  onSelect: (src: string | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: "hidden" });

  useEffect(() => {
    if (!anchorEl) return;
    const r = anchorEl.getBoundingClientRect();
    setStyle({
      position: "fixed",
      top: r.bottom + 4,
      left: Math.max(8, r.left),
      zIndex: 9999,
    });
  }, [anchorEl]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={style}
      className="w-64 rounded-xl border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
    >
      <p className="mb-2 text-xs font-medium text-zinc-500">커버 이미지 선택</p>
      {imageSrcs.length === 0 ? (
        <p className="py-3 text-center text-xs text-zinc-400">표시할 이미지가 없습니다.</p>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {imageSrcs.map((src, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onSelect(src)}
              className="aspect-video overflow-hidden rounded border border-zinc-200 hover:ring-2 hover:ring-blue-400 dark:border-zinc-700"
            >
              <img src={src} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CoverImage({
  column,
  cell,
  pageDoc,
  overrideSrc,
}: {
  column?: ColumnDef;
  cell: import("../../../types/database").CellValue;
  pageDoc?: JSONContent;
  overrideSrc?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    // 오버라이드 src가 있으면 즉시 사용
    if (overrideSrc) {
      setSrc(overrideSrc);
      return;
    }

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
  }, [column, cell, pageDoc, overrideSrc]);

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
