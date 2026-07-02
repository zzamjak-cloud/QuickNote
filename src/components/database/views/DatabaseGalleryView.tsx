import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { JSONContent } from "@tiptap/react";
import { Image } from "lucide-react";
import type {
  DatabasePanelState,
  DatabaseRowView,
  ColumnDef,
  FileCellItem,
} from "../../../types/database";
import { useDatabaseGroupCollapseStore } from "../../../store/databaseGroupCollapseStore";
import { useProcessedRows } from "../useProcessedRows";
import { useRowGroups } from "../useRowGroups";
import { GroupSectionHeader } from "../GroupSectionHeader";
import { resolveActiveFilterRules } from "../../../lib/databaseQuery";
import { DatabaseCell } from "../DatabaseCell";
import { getVisibleOrderedColumns } from "../../../types/database";
import { getDatabaseFile } from "../../../lib/databaseFileStorage";
import { decodeFileRef, isFileRef } from "../../../lib/files/scheme";
import { imageUrlCache } from "../../../lib/images/registry";
import { useImageUrl } from "../../../lib/images/hooks";
import { usePageStore } from "../../../store/pageStore";
import { IconPicker } from "../../common/IconPicker";
import {
  useAddDatabaseRowAndOpen,
  useEnsureDatabaseRowContent,
  useOpenDatabaseRow,
} from "../useOpenDatabaseRow";

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

function fileCellRef(item: FileCellItem): string | null {
  if (item.src) return item.src;
  return isFileRef(item.fileId) ? item.fileId : null;
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
  const addRowAndOpen = useAddDatabaseRowAndOpen(databaseId);
  const ensureRowContent = useEnsureDatabaseRowContent(databaseId);
  const groups = useRowGroups(rows, columns, panelState.groupByColumnId);
  const isCollapsed = useDatabaseGroupCollapseStore((s) => s.isCollapsed);
  const toggleCollapsed = useDatabaseGroupCollapseStore((s) => s.toggle);

  // 행별 커버 이미지 오버라이드 (세션 한정)
  const [coverOverrides, setCoverOverrides] = useState<Map<string, string>>(new Map());

  const coverCandidates = columns.filter(
    (c) => c.type === "file" || c.type === "url",
  );
  const coverColId =
    panelState.galleryCoverColumnId ?? coverCandidates[0]?.id ?? null;
  const coverColumn = useMemo(
    () => columns.find((c) => c.id === coverColId),
    [columns, coverColId],
  );
  const visibleColumns = useMemo(
    () =>
      getVisibleOrderedColumns(
        columns,
        "gallery",
        panelState.viewConfigs,
      ),
    [columns, panelState.viewConfigs],
  );

  // 카드별 인라인 클로저 재생성으로 GalleryCard memo 가 무력화되지 않도록 pageId 인자형 안정 콜백.
  // (훅이므로 early return 보다 위에서 무조건 호출되어야 한다.)
  const setCoverSrc = useCallback((pageId: string, src: string | null) => {
    setCoverOverrides((prev) => {
      const next = new Map(prev);
      if (src) next.set(pageId, src);
      else next.delete(pageId);
      return next;
    });
  }, []);

  if (!bundle) return null;

  const gridStyle = {
    gridTemplateColumns: `repeat(${panelState.galleryColumns ?? 4}, minmax(0, 1fr))`,
  };

  const renderCard = (row: DatabaseRowView) => (
    <GalleryCard
      key={row.pageId}
      databaseId={databaseId}
      row={row}
      columns={columns}
      coverColumn={coverColumn}
      coverSrcOverride={coverOverrides.get(row.pageId)}
      visibleColumns={visibleColumns}
      onSetCoverSrc={setCoverSrc}
      onEnsureRowContent={ensureRowContent}
    />
  );

  const addRowButton = (
    <button
      type="button"
      onClick={() =>
        void addRowAndOpen(resolveActiveFilterRules(panelState), {
          source: "database-gallery-add-row-open",
        })
      }
      className="mt-3 rounded-md px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
    >
      + 새 항목
    </button>
  );

  // 그룹화 렌더 — 그룹 헤더 + 그룹별 카드 그리드(galleryColumns 유지).
  if (groups) {
    return (
      <div className="pt-3">
        {groups.map((group) => {
          const collapsed = isCollapsed(databaseId, "gallery", group.key);
          return (
            <div key={group.key} className="mb-6">
              <GroupSectionHeader
                label={group.label}
                collapsed={collapsed}
                onToggle={() => toggleCollapsed(databaseId, "gallery", group.key)}
              />
              {!collapsed && (
                <div className="mt-2 pl-3">
                  <div className="grid gap-3" style={gridStyle}>
                    {group.rows.map(renderCard)}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {addRowButton}
      </div>
    );
  }

  return (
    <div className="pt-3">
      <div className="grid gap-3" style={gridStyle}>
        {rows.map(renderCard)}
      </div>
      {addRowButton}
    </div>
  );
}

const GalleryCard = memo(function GalleryCard({
  databaseId,
  row,
  columns,
  coverColumn,
  coverSrcOverride,
  visibleColumns,
  onSetCoverSrc,
  onEnsureRowContent,
}: {
  databaseId: string;
  row: DatabaseRowView;
  columns: ColumnDef[];
  coverColumn?: ColumnDef;
  coverSrcOverride?: string;
  visibleColumns: ColumnDef[];
  onSetCoverSrc?: (pageId: string, src: string | null) => void;
  onEnsureRowContent?: (pageId: string, options?: { source?: string }) => Promise<boolean>;
}) {
  const titleCol = columns.find((c) => c.type === "title");
  // 모든 뷰 공통 규칙 — getVisibleOrderedColumns 결과에서 제목/커버만 제외. (설정 없으면 전체 표시)
  const cardCols = visibleColumns.filter(
    (c) => c.id !== titleCol?.id && c.id !== coverColumn?.id,
  );
  const setIcon = usePageStore((s) => s.setIcon);
  const openRow = useOpenDatabaseRow(databaseId);
  const pageDoc = usePageStore((s) => s.pages[row.pageId]?.doc);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerBtnRef = useRef<HTMLButtonElement>(null);

  const imageSrcs = useMemo(() => findAllImageSrcs(pageDoc), [pageDoc]);
  useEffect(() => {
    if (imageSrcs.length > 0) return;
    void onEnsureRowContent?.(row.pageId, { source: "database-gallery-cover-preview" });
  }, [imageSrcs.length, onEnsureRowContent, row.pageId]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => void openRow(row.pageId, { source: "database-gallery-row-open" })}
      onKeyDown={(e) => {
        if (e.key === "Enter") void openRow(row.pageId, { source: "database-gallery-row-open" });
      }}
      style={{ contentVisibility: "auto", containIntrinsicSize: "220px" }}
      className="group w-full cursor-pointer overflow-hidden rounded-xl border border-zinc-200 bg-white text-left shadow-sm transition-shadow hover:shadow-md dark:border-zinc-700 dark:bg-zinc-900"
    >
      {/* 커버 영역 — 이미지 설정 버튼 오버레이 */}
      <div className="relative">
        <CoverImage
          column={coverColumn}
          cell={row.cells[coverColumn?.id ?? ""]}
          pageDoc={pageDoc}
          overrideSrc={coverSrcOverride}
          alt={row.title || undefined}
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
            onSelect={(src) => { onSetCoverSrc?.(row.pageId, src); setPickerOpen(false); }}
            onClose={() => setPickerOpen(false)}
          />,
          document.body,
        )}
      </div>
      <div className="p-2">
        <div className="flex min-w-0 items-center gap-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
          <span className="shrink-0" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
            <IconPicker current={row.icon ?? null} size="sm" onChange={(icon) => setIcon(row.pageId, icon)} />
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
});

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
            <CoverImagePickerThumb
              key={`${src}-${i}`}
              src={src}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CoverImagePickerThumb({
  src,
  onSelect,
}: {
  src: string;
  onSelect: (src: string | null) => void;
}) {
  const { url } = useImageUrl(src);
  return (
    <button
      type="button"
      onClick={() => onSelect(src)}
      className="aspect-video overflow-hidden rounded border border-zinc-200 hover:ring-2 hover:ring-blue-400 dark:border-zinc-700"
    >
      {url ? (
        <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center bg-zinc-100 text-[10px] text-zinc-400 dark:bg-zinc-800">
          로딩
        </span>
      )}
    </button>
  );
}

function CoverImage({
  column,
  cell,
  pageDoc,
  overrideSrc,
  alt,
}: {
  column?: ColumnDef;
  cell: import("../../../types/database").CellValue;
  pageDoc?: JSONContent;
  overrideSrc?: string;
  alt?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const { url: resolvedSrc } = useImageUrl(src);
  const fallbackSrc = useMemo(() => findFirstImageSrc(pageDoc), [pageDoc]);

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
      const ref = fileCellRef(first);
      if (ref) {
        if (typeof first.mime !== "string" || !first.mime.startsWith("image/")) {
          setIfActive(fallbackSrc);
          return () => {
            cancelled = true;
            if (revoked) URL.revokeObjectURL(revoked);
          };
        }
        const fileId = decodeFileRef(ref);
        if (!fileId) {
          setIfActive(ref);
          return () => {
            cancelled = true;
            if (revoked) URL.revokeObjectURL(revoked);
          };
        }
        void imageUrlCache.get(fileId).then(
          (u) => setIfActive(u),
          () => setIfActive(fallbackSrc),
        );
      } else {
        void getDatabaseFile(first.fileId).then((blob) => {
          if (cancelled) return;
          if (blob && blob.type.startsWith("image/")) {
            const u = URL.createObjectURL(blob);
            revoked = u;
            setIfActive(u);
          } else {
            // file 컬럼이지만 이미지가 아니면 페이지 본문 fallback.
            setIfActive(fallbackSrc);
          }
        });
      }
      return () => {
        cancelled = true;
        if (revoked) URL.revokeObjectURL(revoked);
      };
    }

    // 2) Fallback — 페이지 본문 첫 이미지
    setIfActive(fallbackSrc);
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [column, cell, fallbackSrc, overrideSrc]);

  if (!resolvedSrc) {
    return (
      <div className="flex aspect-video items-center justify-center bg-zinc-100 text-[10px] text-zinc-400 dark:bg-zinc-800">
        미리보기
      </div>
    );
  }
  return (
    <img
      src={resolvedSrc}
      alt={alt ? `${alt} 커버 이미지` : ""}
      loading="lazy"
      onError={() => {
        if (fallbackSrc && src !== fallbackSrc) setSrc(fallbackSrc);
      }}
      className="aspect-video w-full object-cover"
    />
  );
}
