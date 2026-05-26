import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeftRight,
  Check,
  ChevronLeft,
  Code,
  Copy,
  CopyPlus,
  FileText,
  FolderInput,
  History,
  Link2,
  Loader2,
  Maximize2,
  Minus,
  MoreHorizontal,
  Printer,
  Trash2,
  X,
} from "lucide-react";
import { useAnchoredPopover } from "../../hooks/useAnchoredPopover";
import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { useUiStore } from "../../store/uiStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useServerPageHistoryStore } from "../../store/serverPageHistoryStore";
import { Editor } from "../editor/Editor";
import { PageTitleBar } from "../page/PageTitleBar";
import { DbPropertySection } from "../page/DbPropertySection";
import { useHistorySelection } from "../history/useHistorySelection";
import { SimpleConfirmDialog } from "../ui/SimpleConfirmDialog";
import { PageMoveDialog } from "../layout/PageMoveDialog";
import { useMemberStore } from "../../store/memberStore";
import { formatPageHistoryEditorLine } from "../../lib/historyEditorLabel";
import { PageCommentBar } from "../comments/PageCommentBar";
import { isLCSchedulerDatabaseId } from "../../lib/scheduler/database";
import { pageDocToMarkdown } from "../../lib/export/pageToMarkdown";
import { pageDocToHtml } from "../../lib/export/pageToHtml";
import { buildQuickNotePageUrl } from "../../lib/navigation/quicknoteLinks";
import { PageCopyToWorkspaceDialog } from "../layout/PageCopyToWorkspaceDialog";
import { computeEditorTailSpacerPx } from "../editor/editorHelpers";
import { PageSubpageTree, countPageDescendants } from "../page/PageSubpageTree";
import { CLEAR_BOX_SELECTION_EVENT } from "../../hooks/boxSelect/constants";

const PEEK_WIDTH_KEY = "quicknote.peekWidth.v1";
const DEFAULT_PEEK_WIDTH = 720;
const MIN_PEEK_WIDTH = 380;
const MAX_PEEK_WIDTH_RATIO = 0.9; // 화면 폭의 90%까지 허용
const CLOSE_LC_SCHEDULER_EVENT = "quicknote:close-lc-scheduler";
const MENU_ITEM_ICON = "size-4 shrink-0 text-zinc-500 dark:text-zinc-400";

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
  const duplicatePage = usePageStore((s) => s.duplicatePage);
  const deletePage = usePageStore((s) => s.deletePage);
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);
  // 피크 페이지 전체너비 상태 — 토글 버튼이 항상 peekPageId 만 타깃팅 (배경의 메인 페이지 변경 방지)
  const globalFullWidth = useSettingsStore((s) => s.fullWidth);
  const pageFullWidthById = useSettingsStore((s) => s.pageFullWidthById);
  const toggleFullWidthForPage = useSettingsStore((s) => s.toggleFullWidthForPage);
  const peekFullWidth = peekPageId
    ? (pageFullWidthById[peekPageId] ?? globalFullWidth)
    : globalFullWidth;
  const page = usePageStore((s) => (peekPageId ? s.pages[peekPageId] : undefined));
  const peekDescendantCount = usePageStore((s) =>
    peekPageId ? countPageDescendants(peekPageId, s.pages) : 0,
  );
  const isPendingPageCreation = Boolean(peekPageId?.startsWith("lc-scheduler:creating:") && !page);
  const renamePage = usePageStore((s) => s.renamePage);
  const setIcon = usePageStore((s) => s.setIcon);

  // 피크에서 "전체 열기" 클릭 시: 현재 활성 페이지를 뒤로가기 대상으로 저장하고
  // 항목 페이지를 활성화하여 전체 페이지 뷰(DatabaseRowPage)가 보이게 한다.
  const openFullPage = () => {
    if (!peekPageId || !page) return;
    const latestPages = usePageStore.getState().pages;
    const latestTarget = latestPages[peekPageId];
    if (!latestTarget) {
      useUiStore.getState().showToast("항목 페이지를 찾지 못했습니다.", { kind: "error" });
      closePeek();
      return;
    }
    const previousActivePageId = activePageId;
    if (isLCSchedulerDatabaseId(page.databaseId)) {
      window.dispatchEvent(new CustomEvent(CLOSE_LC_SCHEDULER_EVENT, {
        detail: { keepSchedulerWorkspace: true },
      }));
    }
    if (activePageId) setRowBackTarget(peekPageId, activePageId);
    let attempts = 0;
    const MAX_ATTEMPTS = 24;
    const verifyAndFinalize = () => {
      const postPages = usePageStore.getState().pages;
      const postActive = usePageStore.getState().activePageId;
      const postTabPage =
        useSettingsStore.getState().tabs[
          useSettingsStore.getState().activeTabIndex
        ]?.pageId ?? null;
      const targetReady =
        !!postPages[peekPageId] &&
        postActive === peekPageId &&
        postTabPage === peekPageId;
      if (targetReady) {
        closePeek();
        return;
      }
      attempts += 1;
      if (attempts < MAX_ATTEMPTS) {
        requestAnimationFrame(verifyAndFinalize);
        return;
      }
      const fallbackActive = previousActivePageId && postPages[previousActivePageId]
        ? previousActivePageId
        : null;
      if (fallbackActive) {
        setCurrentTabPage(fallbackActive);
        setActivePage(fallbackActive);
      }
      useUiStore.getState().showToast("전체 화면 전환에 실패해 이전 화면으로 복구했습니다.", {
        kind: "error",
      });
    };
    const activateFullPage = () => {
      // 즉시 피크를 닫지 않고, 메인 화면에 대상 페이지가 실제로 활성화된 것을 확인한 뒤 닫는다.
      // 전환 실패 시에는 원상복구하여 흰 화면/먹통처럼 보이는 상태를 차단한다.
      setCurrentTabPage(peekPageId);
      setActivePage(peekPageId);
      requestAnimationFrame(verifyAndFinalize);
    };
    window.dispatchEvent(new Event(CLEAR_BOX_SELECTION_EVENT));
    requestAnimationFrame(activateFullPage);
  };
  const databaseId = page?.databaseId;
  const bundle = useDatabaseStore((s) => (databaseId ? s.databases[databaseId] : undefined));
  const pageHistoryTimeline = useServerPageHistoryStore((s) =>
    peekPageId ? s.getPageTimeline(peekPageId) : [],
  );
  const fetchPageHistory = useServerPageHistoryStore((s) => s.fetchPageHistory);
  const restorePageHistoryEvent = useServerPageHistoryStore((s) => s.restorePageHistoryEvent);
  const deletePageHistoryEvents = useServerPageHistoryStore((s) => s.deletePageHistoryEvents);
  const members = useMemberStore((s) => s.members);
  const me = useMemberStore((s) => s.me);
  const showToast = useUiStore((s) => s.showToast);

  const [titleDraft, setTitleDraft] = useState(page?.title ?? "");
  const [width, setWidth] = useState<number>(() => loadPeekWidth());
  const [menuOpen, setMenuOpen] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [copyToWorkspaceOpen, setCopyToWorkspaceOpen] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    label: string;
    eventIds: string[];
  } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const scrollBodyRef = useRef<HTMLDivElement | null>(null);
  const scrollTopByPageRef = useRef<Record<string, number>>({});
  const restoredPageIdRef = useRef<string | null>(null);
  const openedAtRef = useRef(0);
  const [tailSpacerPx, setTailSpacerPx] = useState(240);
  const subpagePopover = useAnchoredPopover(280);

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
    if (!historyDialogOpen || !peekPageId || !page?.workspaceId) return;
    void fetchPageHistory(peekPageId, page.workspaceId);
  }, [fetchPageHistory, historyDialogOpen, page?.workspaceId, peekPageId]);

  useEffect(() => {
    setTitleDraft(page?.title ?? "");
  }, [page?.title, peekPageId]);

  useLayoutEffect(() => {
    const run = (): void => {
      setTailSpacerPx(computeEditorTailSpacerPx());
    };
    run();
    window.addEventListener("resize", run, { passive: true });
    const vv = window.visualViewport;
    vv?.addEventListener("resize", run, { passive: true });
    vv?.addEventListener("scroll", run, { passive: true });
    return () => {
      window.removeEventListener("resize", run);
      vv?.removeEventListener("resize", run);
      vv?.removeEventListener("scroll", run);
    };
  }, []);

  // 피크 스크롤 위치 유지: 페이지 전환(또는 재오픈) 시에만 복원한다.
  // 스크롤 중/드래그 중에는 개입하지 않아 사용자의 스크롤바 조작을 덮어쓰지 않는다.
  useLayoutEffect(() => {
    if (!peekPageId) return;
    if (restoredPageIdRef.current === peekPageId) return;
    const scroller = scrollBodyRef.current;
    if (!scroller) return;
    const savedTop = scrollTopByPageRef.current[peekPageId] ?? 0;
    scroller.scrollTop = Math.max(0, savedTop);
    restoredPageIdRef.current = peekPageId;
  }, [peekPageId]);

  useEffect(() => {
    if (peekPageId) return;
    restoredPageIdRef.current = null;
  }, [peekPageId]);

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

  const copyPageLink = () => {
    if (!peekPageId) return;
    void navigator.clipboard
      .writeText(buildQuickNotePageUrl({ pageId: peekPageId }))
      .then(() => showToast("페이지 링크 복사 완료!", { kind: "success" }))
      .catch(() => showToast("페이지 링크 복사에 실패했습니다.", { kind: "error" }));
    setMenuOpen(false);
  };

  const copyPageContent = () => {
    if (!page) return;
    void navigator.clipboard
      .writeText(pageDocToMarkdown(page.doc))
      .then(() => showToast("페이지 내용 복사 완료!", { kind: "success" }))
      .catch(() => showToast("페이지 내용 복사에 실패했습니다.", { kind: "error" }));
    setMenuOpen(false);
  };

  const handleDuplicate = () => {
    if (!peekPageId) return;
    const newId = duplicatePage(peekPageId);
    if (newId) peekNavigate(newId);
    setMenuOpen(false);
  };

  const handleDelete = () => {
    if (!peekPageId) return;
    deletePage(peekPageId);
    setMenuOpen(false);
    handleClose();
  };

  const handleExportMarkdown = () => {
    if (!page) return;
    const title = page.title || "untitled";
    const md = pageDocToMarkdown(page.doc);
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
    setMenuOpen(false);
  };

  const handleExportPdf = () => {
    window.print();
    setMenuOpen(false);
  };

  const handleExportHtml = () => {
    if (!page) return;
    const title = page.title || "untitled";
    const html = pageDocToHtml(title, page.doc);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
    setMenuOpen(false);
  };

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
        // pageMention 클릭 핸들러가 "피크 내부 클릭" 여부를 식별하는 마커.
        // 이 속성으로 피크 내부 클릭이면 peekNavigate, 외부면 메인 탭 setActivePage 로 분기한다.
        data-qn-peek-editor="true"
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
          <div className="flex items-center gap-1">
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
          </div>
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
            onClick={copyPageLink}
            disabled={isPendingPageCreation}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-zinc-800"
            title="링크 복사"
            aria-label="링크 복사"
          >
            <Link2 size={14} />
          </button>
          <button
            type="button"
            onClick={copyPageContent}
            disabled={isPendingPageCreation}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-zinc-800"
            title="페이지 내용 복사"
            aria-label="페이지 내용 복사"
          >
            <Copy size={14} />
          </button>
          <button
            type="button"
            onClick={handleDuplicate}
            disabled={isPendingPageCreation}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-zinc-800"
            title="페이지 복제"
            aria-label="페이지 복제"
          >
            <CopyPlus size={14} />
          </button>
          <button
            type="button"
            onClick={() => setMoveDialogOpen(true)}
            disabled={isPendingPageCreation}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-zinc-800"
            title="다른 페이지로 이동"
            aria-label="다른 페이지로 이동"
          >
            <FolderInput size={14} />
          </button>
          <button
            type="button"
            onClick={() => setHistoryDialogOpen(true)}
            disabled={isPendingPageCreation}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-zinc-800"
            title="버전 히스토리"
            aria-label="버전 히스토리"
          >
            <History size={14} />
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
              <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={peekFullWidth}
                  title={peekFullWidth ? "전체 너비 보기 끄기 (좁은 본문)" : "전체 너비 보기 켜기"}
                  onClick={() => {
                    if (peekPageId) toggleFullWidthForPage(peekPageId);
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <ArrowLeftRight
                    size={16}
                    className={
                      peekFullWidth
                        ? "size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                        : MENU_ITEM_ICON
                    }
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">전체 너비 보기</span>
                </button>
                <button
                  type="button"
                  onClick={copyPageLink}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <Link2 className={MENU_ITEM_ICON} aria-hidden />
                  <span className="min-w-0 flex-1">링크 복사</span>
                  <span className="shrink-0 text-xs text-zinc-400">⌘L</span>
                </button>
                <button
                  type="button"
                  onClick={copyPageContent}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <Copy className={MENU_ITEM_ICON} aria-hidden />
                  <span className="min-w-0 flex-1">페이지 내용 복사</span>
                </button>
                <button
                  type="button"
                  onClick={handleDuplicate}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <CopyPlus className={MENU_ITEM_ICON} aria-hidden />
                  <span className="min-w-0 flex-1">페이지 복제</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setCopyToWorkspaceOpen(true);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <CopyPlus className={MENU_ITEM_ICON} aria-hidden />
                  <span className="min-w-0 flex-1">다른 워크스페이스로 복제</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setMoveDialogOpen(true);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <FolderInput className={MENU_ITEM_ICON} aria-hidden />
                  <span className="min-w-0 flex-1">다른 페이지로 이동</span>
                  <span className="shrink-0 text-xs text-zinc-400">열기</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setHistoryDialogOpen(true);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <History className={MENU_ITEM_ICON} aria-hidden />
                  <span className="min-w-0 flex-1">버전 히스토리</span>
                  <span className="shrink-0 text-xs text-zinc-400">열기</span>
                </button>
                <hr className="my-1 border-zinc-200 dark:border-zinc-700" />
                <button
                  type="button"
                  onClick={handleExportMarkdown}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <FileText className={MENU_ITEM_ICON} aria-hidden />
                  <span className="min-w-0 flex-1">마크다운 내보내기</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportPdf}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <Printer className={MENU_ITEM_ICON} aria-hidden />
                  <span className="min-w-0 flex-1">PDF 내보내기</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportHtml}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <Code className={MENU_ITEM_ICON} aria-hidden />
                  <span className="min-w-0 flex-1">HTML 내보내기</span>
                </button>
                <hr className="my-1 border-zinc-200 dark:border-zinc-700" />
                <button
                  type="button"
                  onClick={handleDelete}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-zinc-100 dark:text-red-400 dark:hover:bg-zinc-800"
                >
                  <Trash2
                    className="size-4 shrink-0 text-red-600 dark:text-red-400"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">페이지 삭제</span>
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
        <div
          ref={scrollBodyRef}
          onScroll={(e) => {
            if (!peekPageId) return;
            scrollTopByPageRef.current[peekPageId] = e.currentTarget.scrollTop;
          }}
          className="flex-1 overflow-y-auto px-8 pb-8"
        >
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
        <div className="mb-2">
          <PageTitleBar
            pageId={peekPageId}
            icon={page.icon}
            titleDraft={titleDraft}
            titleClassName="min-w-0 flex-1 bg-transparent text-2xl font-semibold outline-none placeholder:text-zinc-400"
            onTitleChange={(v) => setTitleDraft(v)}
            onTitleBlur={() => renamePage(peekPageId, titleDraft.trim() || "제목 없음")}
            onTitleKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            onIconChange={(icon) => setIcon(peekPageId, icon)}
            defaultIcon={<FileText size={56} className="text-zinc-400" />}
            showSubpageTree={peekDescendantCount > 0 || !!page?.parentId}
            subpagePopover={subpagePopover}
          />
        </div>
        {isDbRow && databaseId && (
          <DbPropertySection databaseId={databaseId} pageId={peekPageId} />
        )}
        <PageCommentBar pageId={peekPageId} />
        {/* 노션 스타일: 피크에서도 본문 편집 가능 — Editor에 pageId 주입, bodyOnly로 제목/아이콘 영역 숨김 */}
        <div className="qn-peek-editor mt-2 -mx-8">
          <Editor key={peekPageId} pageId={peekPageId} bodyOnly peek showTailSpacer={false} />
        </div>
        {subpagePopover.open && subpagePopover.coords && createPortal(
          <div
            ref={subpagePopover.popoverRef}
            style={{ position: "fixed", top: subpagePopover.coords.top, left: subpagePopover.coords.left, width: 280, zIndex: 9999 }}
            className="rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          >
            <PageSubpageTree currentPageId={peekPageId} compact onNavigate={(id) => { subpagePopover.close(); peekNavigate(id); }} className="px-2 pb-3 pt-1" hideHeader />
          </div>,
          document.body,
        )}
        <div
          aria-hidden
          className="qn-editor-scroll-tail-spacer shrink-0 select-none"
          style={{ height: tailSpacerPx, minHeight: tailSpacerPx }}
        />
          </>
        ) : null}
        </div>{/* 단일 스크롤 영역 끝 */}
        <PageMoveDialog
          pageId={moveDialogOpen ? peekPageId : null}
          onClose={() => setMoveDialogOpen(false)}
        />
        <PageCopyToWorkspaceDialog
          pageId={copyToWorkspaceOpen ? peekPageId : null}
          onClose={() => setCopyToWorkspaceOpen(false)}
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
                    <div
                      key={entry.id}
                      onClick={() => {
                        const targetEventId = entry.eventIds[entry.eventIds.length - 1];
                        if (targetEventId && peekPageId && page?.workspaceId) {
                          void restorePageHistoryEvent(peekPageId, page.workspaceId, targetEventId);
                        }
                        setHistoryDialogOpen(false);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          const targetEventId = entry.eventIds[entry.eventIds.length - 1];
                          if (targetEventId && peekPageId && page?.workspaceId) {
                            void restorePageHistoryEvent(peekPageId, page.workspaceId, targetEventId);
                          }
                          setHistoryDialogOpen(false);
                        }
                      }}
                      role="button"
                      tabIndex={0}
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
                    </div>
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
            if (peekPageId && page?.workspaceId && deleteTarget) {
              void deletePageHistoryEvents(peekPageId, page.workspaceId, deleteTarget.eventIds);
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
