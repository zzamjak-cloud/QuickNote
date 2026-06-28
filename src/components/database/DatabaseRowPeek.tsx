import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeftRight,
  ChevronLeft,
  Code,
  Copy,
  CopyPlus,
  FileText,
  FolderInput,
  History,
  Link2,
  FolderTree,
  Loader2,
  Maximize2,
  LogIn,
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
import { PageTitleBar } from "../page/PageTitleBar";
import { DbPropertySection } from "../page/DbPropertySection";
import { SimpleConfirmDialog } from "../ui/SimpleConfirmDialog";
import { SimpleAlertDialog } from "../ui/SimpleAlertDialog";
import { PAGE_TITLE_DUPLICATE_MESSAGE, preparePageTitleInput } from "../../store/pageStore/helpers";
import { PageHistoryPreviewDialog } from "../history/PageHistoryPreviewDialog";
import { PageMoveDialog } from "../layout/PageMoveDialog";
import { PageCommentBar } from "../comments/PageCommentBar";
import { isLCSchedulerDatabaseId, isProtectedDatabaseId } from "../../lib/scheduler/database";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../lib/scheduler/scope";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { pageDocToMarkdown } from "../../lib/export/pageToMarkdown";
import { buildPageHtmlZipBlob } from "../../lib/export/pageHtmlZip";
import { collectDatabaseCollection } from "../../lib/export/databaseCollection";
import { buildQuickNotePageUrl } from "../../lib/navigation/quicknoteLinks";
import { navigateToWorkspacePage, peekNavigateToPage } from "../../lib/navigation/internalNavigation";
import { PageCopyToWorkspaceDialog } from "../layout/PageCopyToWorkspaceDialog";
import { computeEditorTailSpacerPx } from "../editor/editorHelpers";
import { PageSubpageTree } from "../page/PageSubpageTree";
import { countPageDescendants } from "../page/pageSubpageTreeUtils";
import { ScrollToTopButton } from "../common/ScrollToTopButton";
import { CLEAR_BOX_SELECTION_EVENT } from "../../hooks/boxSelect/constants";
import {
  bindPageScrollMemory,
  restorePageScrollPosition,
} from "../../lib/navigation/pageScrollMemory";
import { getEditorColumnClass } from "../../lib/editorLayout";
import { useIsMobile } from "../../hooks/useViewport";

const PEEK_WIDTH_KEY = "quicknote.peekWidth.v1";
const DEFAULT_PEEK_WIDTH = 720;
const MIN_PEEK_WIDTH = 380;
const MAX_PEEK_WIDTH_RATIO = 0.9; // 화면 폭의 90%까지 허용
const CLOSE_LC_SCHEDULER_EVENT = "quicknote:close-lc-scheduler";
const MENU_ITEM_ICON = "size-4 shrink-0 text-zinc-500 dark:text-zinc-400";
const PeekEditor = lazy(() =>
  import("../editor/Editor").then((m) => ({ default: m.Editor })),
);

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
  const isMobile = useIsMobile();
  const page = usePageStore((s) => (peekPageId ? s.pages[peekPageId] : undefined));
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  // 다른 워크스페이스의 페이지를 미리보기로 띄운 경우 — "전체 열기"는 로컬 활성화 대신 해당 워크스페이스로 이동한다.
  const isCrossWorkspacePeek = Boolean(
    page?.workspaceId &&
      page.workspaceId !== currentWorkspaceId &&
      !isProtectedDatabaseId(page.databaseId),
  );
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
    // 다른 워크스페이스 페이지: 현재 워크스페이스에 펼치지 않고 해당 워크스페이스로 전환 이동한다.
    if (isCrossWorkspacePeek && page.workspaceId) {
      navigateToWorkspacePage(peekPageId, page.workspaceId);
      closePeek();
      return;
    }
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
    // 보호 DB(작업·마일스톤·피처) 의 전체 페이지는 LC 워크스페이스 컨텍스트에서만 정상 동작.
    // 다른 워크스페이스에서 진입한 경우 워크스페이스를 LC 로 전환해 데이터 동기화 불일치를 방지.
    if (isProtectedDatabaseId(page.databaseId)) {
      const wsState = useWorkspaceStore.getState();
      if (wsState.currentWorkspaceId !== LC_SCHEDULER_WORKSPACE_ID) {
        wsState.setCurrentWorkspaceId(LC_SCHEDULER_WORKSPACE_ID);
      }
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
  const showToast = useUiStore((s) => s.showToast);

  const [titleDraft, setTitleDraft] = useState(page?.title ?? "");
  const titleDraftRef = useRef(titleDraft);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const [titleDuplicateAlert, setTitleDuplicateAlert] = useState(false);
  const [width, setWidth] = useState<number>(() => loadPeekWidth());
  const [menuOpen, setMenuOpen] = useState(false);
  const [addCommentSignal, setAddCommentSignal] = useState(0);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [copyToWorkspaceOpen, setCopyToWorkspaceOpen] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  // 페이지 삭제 확인 (히스토리 삭제와 별개) — 즉시 삭제 방지.
  const [pageDeleteConfirmOpen, setPageDeleteConfirmOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const scrollBodyRef = useRef<HTMLDivElement | null>(null);
  const openedAtRef = useRef(0);
  const [tailSpacerPx, setTailSpacerPx] = useState(240);
  const tailSpacerPxRef = useRef(tailSpacerPx);
  const [editorDeferredReady, setEditorDeferredReady] = useState(false);
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

  useEffect(() => {
    if (!peekPageId) {
      setEditorDeferredReady(false);
      return;
    }
    setEditorDeferredReady(false);
    const id = requestAnimationFrame(() => setEditorDeferredReady(true));
    return () => cancelAnimationFrame(id);
  }, [peekPageId]);

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
  useEffect(() => {
    const next = page?.title ?? "";
    if (titleDraftRef.current === next) return;
    titleDraftRef.current = next;
    setTitleDraft(next);
  }, [page?.title, peekPageId]);

  useLayoutEffect(() => {
    const run = (): void => {
      const px = computeEditorTailSpacerPx();
      if (tailSpacerPxRef.current !== px) {
        tailSpacerPxRef.current = px;
        setTailSpacerPx(px);
      }
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

  useLayoutEffect(() => {
    return restorePageScrollPosition(peekPageId, scrollBodyRef.current, "peek");
  }, [peekPageId]);

  useEffect(() => {
    return bindPageScrollMemory(peekPageId, scrollBodyRef.current, "peek");
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
    setPageDeleteConfirmOpen(true);
    setMenuOpen(false);
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

  const handleExportHtml = async () => {
    if (!page) return;
    const title = page.title || "untitled";
    const blob = await buildPageHtmlZipBlob(title, page.doc, {
      resolveCollection: (id) => collectDatabaseCollection(id),
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title}.zip`;
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
        style={{ width: isMobile ? "100%" : width }}
        // pageMention 클릭 핸들러가 "피크 내부 클릭" 여부를 식별하는 마커.
        // 이 속성으로 피크 내부 클릭이면 peekNavigate, 외부면 메인 탭 setActivePage 로 분기한다.
        data-qn-peek-editor="true"
        className={[
          "absolute right-0 top-0 flex h-full flex-col overflow-hidden border-l border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-950",
          "transition-transform duration-300 ease-out",
          visible ? "translate-x-0" : "translate-x-full",
        ].join(" ")}
      >
        {/* 좌측 리사이즈 핸들 — hover 시 파란 띠. 모바일(전폭)에서는 숨김 */}
        {!isMobile && (
          <div
            onPointerDown={onResizeStart}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeEnd}
            onPointerCancel={onResizeEnd}
            title="피크 너비 조절"
            className="absolute left-0 top-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-blue-400/60"
          />
        )}

        {/* 상단 툴바 — 스크롤 밖에 고정 */}
        <div className="shrink-0 px-8 pt-8">
        <div className="mb-8 flex items-center justify-between gap-1">
          <div className="flex items-center gap-1">
            {/* 전체보기 / 타 워크스페이스면 해당 워크스페이스로 이동 — 헤더 최좌측에 항상 고정 */}
            <button
              type="button"
              onClick={openFullPage}
              disabled={isPendingPageCreation}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-zinc-800"
              title={isCrossWorkspacePeek ? "이 워크스페이스로 이동" : "전체 페이지로 열기"}
              aria-label={isCrossWorkspacePeek ? "이 워크스페이스로 이동" : "전체 페이지로 열기"}
            >
              {isCrossWorkspacePeek ? <LogIn size={14} /> : <Maximize2 size={14} />}
            </button>
            {peekHistory.length > 0 && (
              <button
                type="button"
                onClick={peekBack}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                title="이전 페이지로 돌아가기"
              >
                <ChevronLeft size={14} />
                이전 페이지
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">
          {/* 페이지 트리 — 전체 너비 보기 왼쪽에 배치 */}
          {(peekDescendantCount > 0 || !!page?.parentId) && (
            <button
              ref={subpagePopover.buttonRef}
              type="button"
              onClick={() => subpagePopover.toggle(280)}
              disabled={isPendingPageCreation}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-zinc-800"
              title="페이지 트리"
              aria-label="페이지 트리"
            >
              <FolderTree size={14} />
            </button>
          )}
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
                  <FileText className={MENU_ITEM_ICON} aria-hidden />
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
                  onClick={() => void handleExportHtml()}
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
          data-qn-scroll-page-id={peekPageId ?? undefined}
          data-qn-scroll-scope="peek"
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
        <div className="-mx-8">
          <div
            className={`relative mx-auto w-full ${getEditorColumnClass({
              fullWidth: peekFullWidth,
              hasPageComments: false,
              peek: true,
              isMobile,
            })}`}
            data-qn-peek-page-header-column
          >
            <div className="md:px-12">
              <div className="mb-2">
                <PageTitleBar
                  pageId={peekPageId}
                  icon={page.icon}
                  titleDraft={titleDraft}
                  titleRef={titleInputRef}
                  titleClassName="min-w-0 flex-1 bg-transparent text-2xl font-semibold outline-none placeholder:text-zinc-400"
                  onTitleChange={(v) => {
                    titleDraftRef.current = v;
                    setTitleDraft(v);
                  }}
                  onTitleBlur={() => {
                    if (!page) return;
                    const nextTitle = preparePageTitleInput(titleDraft);
                    if (nextTitle === page.title) return;
                    const ok = renamePage(peekPageId, nextTitle);
                    if (!ok) setTitleDuplicateAlert(true);
                  }}
                  onTitleKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  onIconChange={(icon) => setIcon(peekPageId, icon)}
                  onAddComment={() => setAddCommentSignal((n) => n + 1)}
                  defaultIcon={<FileText size={56} className="text-zinc-400" />}
                />
              </div>
              {isDbRow && databaseId && (
                <DbPropertySection databaseId={databaseId} pageId={peekPageId} />
              )}
              <PageCommentBar pageId={peekPageId} openComposerSignal={addCommentSignal} />
            </div>
          </div>
        </div>
        {/* 노션 스타일: 피크에서도 본문 편집 가능 — Editor에 pageId 주입, bodyOnly로 제목/아이콘 영역 숨김 */}
        <div className="qn-peek-editor mt-2 -mx-8">
          {editorDeferredReady ? (
            <Suspense
              fallback={(
                <div className="flex min-h-[220px] items-center justify-center text-zinc-500">
                  <Loader2 size={16} className="mr-2 animate-spin" />
                  불러오는 중...
                </div>
              )}
            >
              <PeekEditor key={peekPageId} pageId={peekPageId} bodyOnly peek showTailSpacer={false} />
            </Suspense>
          ) : (
            <div className="min-h-[220px]" />
          )}
        </div>
        {subpagePopover.open && subpagePopover.coords && createPortal(
          <div
            ref={subpagePopover.popoverRef}
            style={{ position: "fixed", top: subpagePopover.coords.top, left: subpagePopover.coords.left, width: 280, zIndex: 9999 }}
            className="rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          >
            <PageSubpageTree currentPageId={peekPageId} compact onNavigate={(id) => peekNavigateToPage(id)} className="px-2 pb-3 pt-1" hideHeader />
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
        {!isPendingPageCreation && (
          <ScrollToTopButton scrollRef={scrollBodyRef} position="absolute" />
        )}
        <PageCopyToWorkspaceDialog
          pageId={copyToWorkspaceOpen ? peekPageId : null}
          onClose={() => setCopyToWorkspaceOpen(false)}
        />
        <PageMoveDialog
          pageId={moveDialogOpen ? peekPageId : null}
          onClose={() => setMoveDialogOpen(false)}
        />
        <PageHistoryPreviewDialog
          open={historyDialogOpen}
          pageId={peekPageId}
          workspaceId={page?.workspaceId ?? null}
          isInsidePeek
          onClose={() => setHistoryDialogOpen(false)}
        />
        <SimpleConfirmDialog
          open={pageDeleteConfirmOpen}
          title="페이지 삭제"
          message="이 페이지를 삭제할까요? 이 작업은 되돌릴 수 없습니다."
          confirmLabel="삭제"
          danger
          // 피커뷰 오버레이(z-[650])·내부 모달(z-[670]) 위에 떠야 함.
          zIndex={700}
          onCancel={() => setPageDeleteConfirmOpen(false)}
          onConfirm={() => {
            setPageDeleteConfirmOpen(false);
            if (peekPageId) deletePage(peekPageId);
            handleClose();
          }}
        />
        <SimpleAlertDialog
          open={titleDuplicateAlert}
          message={PAGE_TITLE_DUPLICATE_MESSAGE}
          // 피커뷰 오버레이(z-[650])·내부 모달(z-[670]) 위에 떠야 함.
          zIndex={700}
          onClose={() => {
            setTitleDuplicateAlert(false);
            if (page) {
              titleDraftRef.current = page.title;
              setTitleDraft(page.title);
            }
            window.setTimeout(() => {
              titleInputRef.current?.focus();
              titleInputRef.current?.select();
            }, 0);
          }}
        />
      </div>
    </div>
  );
}
