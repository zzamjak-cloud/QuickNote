import { useEffect, useRef, useState } from "react";
import { X, MoreHorizontal, Trash2, Check, Minus } from "lucide-react";
import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { useUiStore } from "../../store/uiStore";
import { useHistoryStore } from "../../store/historyStore";
import { DatabasePropertyPanel } from "./DatabasePropertyPanel";
import { Editor } from "../editor/Editor";
import { useHistorySelection } from "../history/useHistorySelection";
import { SimpleConfirmDialog } from "../ui/SimpleConfirmDialog";
import { PageMoveDialog } from "../layout/PageMoveDialog";

const PEEK_WIDTH_KEY = "quicknote.peekWidth.v1";
const DEFAULT_PEEK_WIDTH = 720;
const MIN_PEEK_WIDTH = 380;
const MAX_PEEK_WIDTH_RATIO = 0.9; // 화면 폭의 90%까지 허용

function loadPeekWidth(): number {
  if (typeof window === "undefined") return DEFAULT_PEEK_WIDTH;
  const raw = localStorage.getItem(PEEK_WIDTH_KEY);
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < MIN_PEEK_WIDTH) return DEFAULT_PEEK_WIDTH;
  return n;
}

export function DatabaseRowPeek() {
  const peekPageId = useUiStore((s) => s.peekPageId);
  const closePeek = useUiStore((s) => s.closePeek);
  const page = usePageStore((s) => (peekPageId ? s.pages[peekPageId] : undefined));
  const renamePage = usePageStore((s) => s.renamePage);
  const restorePageFromHistoryEvent = usePageStore(
    (s) => s.restorePageFromHistoryEvent,
  );
  const databaseId = page?.databaseId;
  const bundle = useDatabaseStore((s) => (databaseId ? s.databases[databaseId] : undefined));
  const pageHistoryTimeline = useHistoryStore((s) =>
    peekPageId ? s.getPageTimeline(peekPageId) : [],
  );
  const deletePageHistoryEvents = useHistoryStore((s) => s.deletePageHistoryEvents);

  const [titleDraft, setTitleDraft] = useState(page?.title ?? "");
  const [width, setWidth] = useState<number>(() => loadPeekWidth());
  const [menuOpen, setMenuOpen] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    label: string;
    eventIds: string[];
  } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const timelineIds = pageHistoryTimeline.map((e) => e.id);
  const {
    selectedIds: selectedTimelineIds,
    toggleOne: toggleTimelineOne,
    toggleAll: toggleTimelineAll,
    clearSelection: clearTimelineSelection,
  } = useHistorySelection(timelineIds);
  const selectedEntries = pageHistoryTimeline.filter((e) =>
    selectedTimelineIds.has(e.id),
  );
  const selectedEventIds = selectedEntries.flatMap((e) => e.eventIds);

  useEffect(() => {
    setTitleDraft(page?.title ?? "");
  }, [page?.title, peekPageId]);

  useEffect(() => {
    if (!peekPageId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePeek();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [peekPageId, closePeek]);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  // 너비 드래그 — 좌측 모서리를 잡고 좌우로 이동.
  const dragRef = useRef<{ originX: number; originWidth: number } | null>(null);
  const onResizeStart = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { originX: e.clientX, originWidth: width };
    document.body.style.cursor = "col-resize";
  };
  const onResizeMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.originX;
    const max = Math.floor(window.innerWidth * MAX_PEEK_WIDTH_RATIO);
    // 좌측 핸들이므로 왼쪽으로 끌면(negative dx) 폭 증가.
    const next = Math.min(max, Math.max(MIN_PEEK_WIDTH, d.originWidth - dx));
    setWidth(next);
  };
  const onResizeEnd = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch { /* noop */ }
    dragRef.current = null;
    document.body.style.cursor = "";
    localStorage.setItem(PEEK_WIDTH_KEY, String(width));
  };

  if (!peekPageId || !page || !databaseId || !bundle) return null;

  return (
    <div
      onClick={closePeek}
      className="fixed inset-0 z-40 bg-black/30"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width }}
        className="absolute right-0 top-0 flex h-full flex-col overflow-y-auto border-l border-zinc-200 bg-white p-8 shadow-xl dark:border-zinc-700 dark:bg-zinc-950"
      >
        {/* 좌측 리사이즈 핸들 — hover 시 파란 띠 */}
        <div
          onPointerDown={onResizeStart}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeEnd}
          onPointerCancel={onResizeEnd}
          title="피크 너비 조절"
          className="absolute left-0 top-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-blue-400/60"
        />

        <div className="mb-4 flex items-center justify-end gap-1">
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              title="항목 페이지 메뉴"
              aria-label="항목 페이지 메뉴"
            >
              <MoreHorizontal size={16} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 w-52 rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setMoveDialogOpen(true);
                  }}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span>다른 페이지로 이동</span>
                  <span className="text-xs text-zinc-400">열기</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setHistoryDialogOpen(true);
                  }}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span>버전 히스토리</span>
                  <span className="text-xs text-zinc-400">열기</span>
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={closePeek}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X size={16} />
          </button>
        </div>
        <input
          type="text"
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={() => renamePage(peekPageId, titleDraft.trim() || "제목 없음")}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          placeholder="제목 없음"
          className="mb-2 w-full bg-transparent text-2xl font-semibold outline-none placeholder:text-zinc-400"
        />
        <DatabasePropertyPanel databaseId={databaseId} pageId={peekPageId} />
        {/* 노션 스타일: 피크에서도 본문 편집 가능 — Editor에 pageId 주입, bodyOnly로 제목/아이콘 영역 숨김 */}
        <div className="qn-peek-editor mt-2 -mx-8 flex flex-1 flex-col">
          <Editor key={peekPageId} pageId={peekPageId} bodyOnly />
        </div>
        <PageMoveDialog
          pageId={moveDialogOpen ? peekPageId : null}
          onClose={() => setMoveDialogOpen(false)}
        />
        {historyDialogOpen && (
          <div
            className="fixed inset-0 z-[420] flex items-center justify-center bg-black/45 p-4"
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setHistoryDialogOpen(false);
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="qn-peek-page-history-title"
              className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2
                  id="qn-peek-page-history-title"
                  className="text-sm font-semibold text-zinc-900 dark:text-zinc-100"
                >
                  페이지 버전 히스토리
                </h2>
                <button
                  type="button"
                  onClick={() => setHistoryDialogOpen(false)}
                  className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  닫기
                </button>
              </div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={toggleTimelineAll}
                  className="inline-flex items-center gap-1 rounded border border-zinc-200 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  {selectedTimelineIds.size > 0 &&
                  selectedTimelineIds.size === timelineIds.length ? (
                    <Check size={12} />
                  ) : selectedTimelineIds.size > 0 ? (
                    <Minus size={12} />
                  ) : (
                    <span className="inline-block h-3 w-3 rounded-sm border border-zinc-400" />
                  )}
                  전체 선택
                </button>
                {selectedTimelineIds.size > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteTarget({
                        label: `${selectedTimelineIds.size}개 선택 항목`,
                        eventIds: selectedEventIds,
                      });
                      setDeleteConfirmOpen(true);
                    }}
                    className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-900/40 dark:hover:bg-red-950/30"
                  >
                    선택 삭제
                  </button>
                )}
              </div>
              <div className="max-h-[55vh] overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-700">
                {pageHistoryTimeline.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-zinc-500">
                    버전 기록이 없습니다.
                  </div>
                ) : (
                  pageHistoryTimeline.slice(0, 100).map((entry, idx, arr) => (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => {
                        const targetEventId = entry.eventIds[entry.eventIds.length - 1];
                        if (targetEventId && peekPageId) {
                          restorePageFromHistoryEvent(peekPageId, targetEventId);
                        }
                        setHistoryDialogOpen(false);
                      }}
                      className="flex w-full items-center justify-between gap-2 border-b border-zinc-100 px-3 py-2 text-left text-xs last:border-b-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleTimelineOne(entry.id, { shiftKey: e.shiftKey });
                        }}
                        className={[
                          "inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border",
                          selectedTimelineIds.has(entry.id)
                            ? "border-blue-500 bg-blue-500 text-white"
                            : "border-zinc-400",
                        ].join(" ")}
                        aria-label="히스토리 선택"
                      >
                        {selectedTimelineIds.has(entry.id) ? (
                          <Check size={10} strokeWidth={3} />
                        ) : null}
                      </button>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-zinc-700 dark:text-zinc-200">
                          {`버전 ${arr.length - idx}`}
                        </span>
                        <span className="block text-[11px] text-zinc-400">
                          변경자 정보는 추후 추가 예정
                        </span>
                      </span>
                      <span className="shrink-0 text-[11px] text-zinc-400">
                        {new Date(entry.endTs).toLocaleString()}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget({
                            label: `버전 ${arr.length - idx}`,
                            eventIds: entry.eventIds,
                          });
                          setDeleteConfirmOpen(true);
                        }}
                        className="shrink-0 rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                        title="히스토리 항목 삭제"
                        aria-label="히스토리 항목 삭제"
                      >
                        <Trash2 size={12} />
                      </button>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
        <SimpleConfirmDialog
          open={deleteConfirmOpen}
          title="히스토리 항목 삭제"
          message={`"${deleteTarget?.label ?? "선택한 항목"}" 히스토리를 삭제할까요?`}
          confirmLabel="삭제"
          danger
          onCancel={() => {
            setDeleteConfirmOpen(false);
            setDeleteTarget(null);
          }}
          onConfirm={() => {
            if (peekPageId && deleteTarget) {
              deletePageHistoryEvents(peekPageId, deleteTarget.eventIds);
            }
            setDeleteConfirmOpen(false);
            setDeleteTarget(null);
            clearTimelineSelection();
          }}
        />
      </div>
    </div>
  );
}
