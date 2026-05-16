import { useCallback, useEffect, useRef, useState } from "react";
import { X, MoreHorizontal, Trash2, Check, Minus, Maximize2, ChevronLeft, FileText, ArrowLeftRight, Loader2 } from "lucide-react";
import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { useUiStore } from "../../store/uiStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useHistoryStore } from "../../store/historyStore";
import { DatabasePropertyPanel } from "./DatabasePropertyPanel";
import { Editor } from "../editor/Editor";
import { IconPicker } from "../common/IconPicker";
import { useHistorySelection } from "../history/useHistorySelection";
import { SimpleConfirmDialog } from "../ui/SimpleConfirmDialog";
import { PageMoveDialog } from "../layout/PageMoveDialog";
import { useMemberStore } from "../../store/memberStore";
import { formatPageHistoryEditorLine } from "../../lib/historyEditorLabel";
import { PageCommentBar } from "../comments/PageCommentBar";

const PEEK_WIDTH_KEY = "quicknote.peekWidth.v1";
const DEFAULT_PEEK_WIDTH = 720;
const MIN_PEEK_WIDTH = 380;
const MAX_PEEK_WIDTH_RATIO = 0.9; // 화면 폭의 90%까지 허용
const CLOSE_LC_SCHEDULER_EVENT = "quicknote:close-lc-scheduler";

function loadPeekWidth(): number {
  if (typeof window === "undefined") return DEFAULT_PEEK_WIDTH;
  const raw = localStorage.getItem(PEEK_WIDTH_KEY);
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < MIN_PEEK_WIDTH) return DEFAULT_PEEK_WIDTH;
  return n;
}

export function DatabaseRowPeek() {
  const peekPageId = useUiStore((s) => s.peekPageId);
  const peekHistory = useUiStore((s) => s.peekHistory);
  const closePeek = useUiStore((s) => s.closePeek);
  const peekBack = useUiStore((s) => s.peekBack);
  const peekNavigate = useUiStore((s) => s.peekNavigate);
  const setRowBackTarget = useUiStore((s) => s.setRowBackTarget);
  const activePageId = usePageStore((s) => s.activePageId);
  const setActivePage = usePageStore((s) => s.setActivePage);
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);
  // 피크 페이지 전체너비 상태 — 토글 버튼이 항상 peekPageId 만 타깃팅 (배경의 메인 페이지 변경 방지)
  const globalFullWidth = useSettingsStore((s) => s.fullWidth);
  const pageFullWidthById = useSettingsStore((s) => s.pageFullWidthById);
  const toggleFullWidthForPage = useSettingsStore((s) => s.toggleFullWidthForPage);
  const peekFullWidth = peekPageId
    ? (pageFullWidthById[peekPageId] ?? globalFullWidth)
    : globalFullWidth;
  const allPages = usePageStore((s) => s.pages);
  const page = peekPageId ? allPages[peekPageId] : undefined;
  const isPendingPageCreation = Boolean(peekPageId?.startsWith("lc-scheduler:creating:") && !page);
  const childPages = peekPageId
    ? Object.values(allPages).filter((p) => p.parentId === peekPageId)
    : [];
  const renamePage = usePageStore((s) => s.renamePage);
  const setIcon = usePageStore((s) => s.setIcon);
  const restorePageFromHistoryEvent = usePageStore(
    (s) => s.restorePageFromHistoryEvent,
  );

  // 피크에서 "전체 열기" 클릭 시: 현재 활성 페이지를 뒤로가기 대상으로 저장하고
  // 항목 페이지를 활성화하여 전체 페이지 뷰(DatabaseRowPage)가 보이게 한다.
  const openFullPage = () => {
    if (!peekPageId) return;
    window.dispatchEvent(new CustomEvent(CLOSE_LC_SCHEDULER_EVENT, {
      detail: { keepSchedulerWorkspace: true },
    }));
    if (activePageId) setRowBackTarget(peekPageId, activePageId);
    setActivePage(peekPageId);
    setCurrentTabPage(peekPageId);
    closePeek();
  };
  const databaseId = page?.databaseId;
  const bundle = useDatabaseStore((s) => (databaseId ? s.databases[databaseId] : undefined));
  const pageHistoryTimeline = useHistoryStore((s) =>
    peekPageId ? s.getPageTimeline(peekPageId) : [],
  );
  const deletePageHistoryEvents = useHistoryStore((s) => s.deletePageHistoryEvents);
  const members = useMemberStore((s) => s.members);
  const me = useMemberStore((s) => s.me);

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
  const openedAtRef = useRef(0);

  // 슬라이드·딤머 애니메이션 상태
  const [visible, setVisible] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);

  // 피크가 열릴 때: 다음 프레임에 visible=true 로 슬라이드-인 트리거
  useEffect(() => {
    if (!peekPageId) return;
    openedAtRef.current = Date.now();
    if (isPendingPageCreation) {
      setVisible(true);
      return;
    }
    if (closeTimerRef.current != null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = requestAnimationFrame(() => {
        setVisible(true);
        rafRef.current = null;
      });
    });
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isPendingPageCreation, peekPageId]);

  // 애니메이션 포함 닫기: slide-out 후 closePeek 호출
  const handleClose = useCallback(() => {
    setVisible(false);
    closeTimerRef.current = setTimeout(() => {
      closePeek();
      closeTimerRef.current = null;
    }, 280);
  }, [closePeek]);
  const handleBackdropClick = useCallback(() => {
    if (Date.now() - openedAtRef.current < 160) return;
    handleClose();
  }, [handleClose]);
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
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [peekPageId, handleClose]);
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

  // 피크는 DB 항목뿐 아니라 하위 일반 페이지 등 모든 페이지를 렌더할 수 있어야 함
  // (DB 항목에서 /새 페이지 로 만든 하위 페이지 클릭 시 peekNavigate 로 진입)
  if (!peekPageId || (!page && !isPendingPageCreation)) return null;
  const isDbRow = !!(databaseId && bundle);

  return (
    <div
      onClick={handleBackdropClick}
      // 스케줄러 모달(z-[500]) 위에서도 항목 피커가 보여야 한다.
      className={[
        "fixed inset-0 z-[650] bg-black/40 transition-opacity duration-300",
        visible ? "opacity-100" : "opacity-0",
      ].join(" ")}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width }}
        className={[
          "absolute right-0 top-0 flex h-full flex-col overflow-hidden border-l border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-950",
          "transition-transform duration-300 ease-out",
          visible ? "translate-x-0" : "translate-x-full",
        ].join(" ")}
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

        {/* 상단 툴바 — 스크롤 밖에 고정 */}
        <div className="shrink-0 px-8 pt-8">
        <div className="mb-8 flex items-center justify-between gap-1">
          {peekHistory.length > 0 ? (
            <button
              type="button"
              onClick={peekBack}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              title="이전 페이지로 돌아가기"
            >
              <ChevronLeft size={14} />
              이전 페이지
            </button>
          ) : (
            <div />
          )}
          <div className="flex items-center gap-1">
          {/* 전체너비 토글 — 피크 페이지만 타깃팅(배경의 활성 페이지를 건드리지 않음) */}
          <button
            type="button"
            onClick={() => peekPageId && toggleFullWidthForPage(peekPageId)}
            className={`rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
              peekFullWidth
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-zinc-500"
            }`}
            title={peekFullWidth ? "전체 너비 끄기" : "전체 너비 켜기"}
            aria-label="전체 너비 토글"
            aria-pressed={peekFullWidth}
          >
            <ArrowLeftRight size={14} strokeWidth={peekFullWidth ? 2.25 : 2} />
          </button>
          <button
            type="button"
            onClick={openFullPage}
            disabled={isPendingPageCreation}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-zinc-800"
            title="전체 페이지로 열기"
            aria-label="전체 페이지로 열기"
          >
            <Maximize2 size={14} />
          </button>
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              disabled={isPendingPageCreation}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-zinc-800"
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
            onClick={handleClose}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X size={16} />
          </button>
          </div>{/* 우측 버튼 그룹 끝 */}
        </div>
        </div>{/* 상단 툴바 끝 */}

        {/* 단일 스크롤 영역 — 제목·속성·본문·하위페이지 모두 포함 */}
        <div className="flex-1 overflow-y-auto px-8 pb-8">
        {isPendingPageCreation ? (
          <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 text-center">
            <Loader2 size={22} className="animate-spin text-blue-500" />
            <div>
              <p className="text-base font-medium text-zinc-800 dark:text-zinc-100">페이지 생성중...</p>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">일정 카드는 먼저 표시되고, 항목 페이지를 준비하고 있습니다.</p>
            </div>
          </div>
        ) : page ? (
          <>
        <div className="mb-2 flex min-w-0 items-center gap-2">
          <IconPicker
            current={page.icon}
            onChange={(icon) => setIcon(peekPageId, icon)}
            defaultIcon={<FileText size={28} className="text-zinc-400" />}
          />
          <input
            type="text"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => renamePage(peekPageId, titleDraft.trim() || "제목 없음")}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            placeholder="제목 없음"
            className="min-w-0 flex-1 bg-transparent text-2xl font-semibold outline-none placeholder:text-zinc-400"
          />
        </div>
        {isDbRow && databaseId ? (
          <DatabasePropertyPanel databaseId={databaseId} pageId={peekPageId} />
        ) : null}
        <PageCommentBar pageId={peekPageId} />
        {/* 노션 스타일: 피크에서도 본문 편집 가능 — Editor에 pageId 주입, bodyOnly로 제목/아이콘 영역 숨김 */}
        <div className="qn-peek-editor mt-2 -mx-8">
          <Editor key={peekPageId} pageId={peekPageId} bodyOnly peek />
        </div>
        {/* 항목 내 하위 페이지 목록 */}
        {childPages.length > 0 && (
          <div className="mt-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
            <p className="mb-2 text-xs font-semibold text-zinc-400 dark:text-zinc-500">하위 페이지</p>
            <div className="flex flex-col gap-0.5">
              {childPages.map((cp) => (
                <button
                  key={cp.id}
                  type="button"
                  onClick={() => peekNavigate(cp.id)}
                  className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  <span className="shrink-0 text-base leading-none">{cp.icon ?? <FileText size={14} />}</span>
                  <span className="truncate">{cp.title || "제목 없음"}</span>
                </button>
              ))}
            </div>
          </div>
        )}
          </>
        ) : null}
        </div>{/* 단일 스크롤 영역 끝 */}
        <PageMoveDialog
          pageId={moveDialogOpen ? peekPageId : null}
          onClose={() => setMoveDialogOpen(false)}
        />
        {historyDialogOpen && (
          <div
            className="fixed inset-0 z-[670] flex items-center justify-center bg-black/45 p-4"
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
                          {formatPageHistoryEditorLine(entry, { members, me })}
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
