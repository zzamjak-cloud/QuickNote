import {
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  Code,
  FileText,
  MoreHorizontal,
  Printer,
  Trash2,
  Link2,
  Copy,
  CopyPlus,
  FolderInput,
  History,
  FolderTree,
  X,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPopover } from "../../hooks/useAnchoredPopover";
import { PageSubpageTree } from "../page/PageSubpageTree";
import { countPageDescendants } from "../page/pageSubpageTreeUtils";
import { pageDocToMarkdown } from "../../lib/export/pageToMarkdown";
import { pageDocToHtml } from "../../lib/export/pageToHtml";
import { buildQuickNotePageUrl } from "../../lib/navigation/quicknoteLinks";
import type { Page } from "../../types/page";

/** 페이지 메뉴 드롭다운 왼쪽 아이콘 공통 스타일 */
const MENU_ITEM_ICON =
  "size-4 shrink-0 text-zinc-500 dark:text-zinc-400";

function isLCSchedulerModalOpen(): boolean {
  return Boolean(document.querySelector("[data-lc-scheduler-modal='true']"));
}

function isFullPageDatabasePage(page: Page | undefined): boolean {
  const content = page?.doc?.content;
  if (!Array.isArray(content) || content.length === 0) return false;
  const first = content[0];
  return (
    first?.type === "databaseBlock" &&
    first.attrs != null &&
    first.attrs.layout === "fullPage" &&
    typeof first.attrs.databaseId === "string" &&
    first.attrs.databaseId.length > 0
  );
}
import { useSettingsStore } from "../../store/settingsStore";
import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { useUiStore } from "../../store/uiStore";
import { NotificationBell } from "../notifications/NotificationBell";
import { SimpleConfirmDialog } from "../ui/SimpleConfirmDialog";
import { PageHistoryPreviewDialog } from "../history/PageHistoryPreviewDialog";
import { PageIconDisplay } from "../common/PageIconDisplay";
import { PageMoveDialog } from "./PageMoveDialog";
import { PageCopyToWorkspaceDialog } from "./PageCopyToWorkspaceDialog";
import { useNavigationHistoryStore } from "../../store/navigationHistoryStore";

export function TopBar() {
  const sidebarCollapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const globalFullWidth = useSettingsStore((s) => s.fullWidth);
  const pageFullWidthById = useSettingsStore((s) => s.pageFullWidthById);
  const toggleFullWidthForPage = useSettingsStore((s) => s.toggleFullWidthForPage);
  const navigateToParentPage = usePageStore((s) => s.navigateToParentPage);
  const activeId = usePageStore((s) => s.activePageId);
  const pages = usePageStore((s) => s.pages);
  const setActive = usePageStore((s) => s.setActivePage);
  const duplicatePage = usePageStore((s) => s.duplicatePage);
  const deletePage = usePageStore((s) => s.deletePage);
  const databases = useDatabaseStore((s) => s.databases);
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);
  const setCurrentTabDatabase = useSettingsStore((s) => s.setCurrentTabDatabase);
  const showToast = useUiStore((s) => s.showToast);
  const previousNavigationPageId = useNavigationHistoryStore((s) => s.peekBack());
  const popNavigationBack = useNavigationHistoryStore((s) => s.popBack);
  const clearNavigationBack = useNavigationHistoryStore((s) => s.clearBack);
  const backStack = useNavigationHistoryStore((s) => s.backStack);
  const lastTargetPageId = useNavigationHistoryStore((s) => s.lastTargetPageId);
  const jumpToNavigation = useNavigationHistoryStore((s) => s.jumpTo);

  const [menuOpen, setMenuOpen] = useState(false);
  const subpagePopover = useAnchoredPopover(280);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [copyToWorkspaceOpen, setCopyToWorkspaceOpen] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  // 페이지 삭제 확인 (히스토리 삭제와 별개) — 즉시 삭제 방지.
  const [pageDeleteConfirmOpen, setPageDeleteConfirmOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const activeWorkspaceId = activeId ? pages[activeId]?.workspaceId ?? null : null;

  type BreadcrumbNode = { id: string; title: string; icon: string | null; noNav?: boolean; dbId?: string };
  const breadcrumb: BreadcrumbNode[] = [];
  if (activeId) {
    // parentId 체인을 수집
    const chain: Page[] = [];
    let cursor: string | null = activeId;
    const seen = new Set<string>();
    while (cursor !== null) {
      if (seen.has(cursor)) break;
      seen.add(cursor);
      const page: Page | undefined = pages[cursor];
      if (!page) break;
      chain.unshift(page);
      if (page.databaseId != null) {
        // DB row 페이지는 parentId=null이므로 체인 탐색 종료
        // DB 컨테이너 페이지 + DB 이름을 앞에 삽입
        const dbBundle = databases[page.databaseId];
        const containerPageId = usePageStore.getState().findFullPagePageIdForDatabase(page.databaseId);
        if (containerPageId) {
          const containerChain: BreadcrumbNode[] = [];
          let c: string | null = pages[containerPageId]?.parentId ?? null;
          const cs = new Set<string>();
          while (c !== null) {
            if (cs.has(c)) break;
            cs.add(c);
            const cp: Page | undefined = pages[c];
            if (!cp) break;
            containerChain.unshift({ id: cp.id, title: cp.title, icon: cp.icon });
            c = cp.parentId;
          }
          breadcrumb.push(...containerChain);
        }
        if (dbBundle) {
          // DB 이름 노드가 컨테이너 페이지를 대표 — 중복 방지를 위해 컨테이너 페이지 자체는 체인에서 제외
          breadcrumb.push({
            id: containerPageId ?? `db-virtual-${page.databaseId}`,
            title: dbBundle.meta.title,
            icon: null,
            dbId: page.databaseId,
          });
        }
        break;
      }
      cursor = page.parentId;
    }
    for (const p of chain) {
      breadcrumb.push({ id: p.id, title: p.title, icon: p.icon });
    }
  }

  const activePage = activeId ? pages[activeId] : undefined;
  const fullWidth = activeId
    ? (pageFullWidthById[activeId] ?? globalFullWidth)
    : globalFullWidth;
  // 페이지 트리 버튼 표시 조건 — 풀페이지 DB(그리드) 페이지가 아니면 표시(DB 항목 페이지 포함).
  const descendantCount = activeId ? countPageDescendants(activeId, pages) : 0;
  const showSubpageTree = Boolean(
    activeId &&
      !isFullPageDatabasePage(activePage) &&
      (descendantCount > 0 || !!activePage?.parentId),
  );
  const parentId = activePage?.parentId ?? null;
  const canGoBack =
    Boolean(activeId && parentId !== null && pages[parentId ?? ""]);
  const hasNavTrail = backStack.length > 1;
  // 멘션·링크·블록 링크·DB 전환 등으로 이전 페이지가 기록돼 있으면 "이전 페이지" 버튼을 노출
  // (기존엔 DB 풀페이지에서만 노출했으나 일반 페이지 멘션/링크 이동도 지원).
  const showPreviousButton = Boolean(!hasNavTrail && previousNavigationPageId);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isLCSchedulerModalOpen()) return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || !activeId) return;
      if (e.key === "l" || e.key === "L") {
        e.preventDefault();
        setMenuOpen(false);
        void navigator.clipboard
          .writeText(buildQuickNotePageUrl({ pageId: activeId }))
          .then(() => showToast("페이지 링크 복사 완료!", { kind: "success" }))
          .catch(() =>
            showToast("페이지 링크 복사에 실패했습니다.", { kind: "error" }),
          );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, showToast]);
  // 링크셀(dbLink/pageLink) 네비게이션 중에는 backStack > 1이므로 클리어하지 않음
  // backStack === 1(기존 DB 인라인→풀페이지 전환)만 비-DB 페이지 이동 시 클리어.
  // 단, 멘션/링크로 "도착"한 페이지(lastTargetPageId)에 머무는 동안엔 유효한 백스택이므로 유지한다.
  useEffect(() => {
    if (!activeId || !activePage || !previousNavigationPageId) return;
    if (isFullPageDatabasePage(activePage)) return;
    if (backStack.length > 1) return;
    if (activeId === lastTargetPageId) return;
    clearNavigationBack();
  }, [
    activeId,
    activePage,
    backStack.length,
    clearNavigationBack,
    previousNavigationPageId,
    lastTargetPageId,
  ]);

  const handleDuplicate = () => {
    if (!activeId) return;
    const newId = duplicatePage(activeId);
    if (newId) setActive(newId);
    setMenuOpen(false);
  };

  const copyPageLink = () => {
    if (!activeId) return;
    void navigator.clipboard
      .writeText(buildQuickNotePageUrl({ pageId: activeId }))
      .then(() => showToast("페이지 링크 복사 완료!", { kind: "success" }))
      .catch(() => showToast("페이지 링크 복사에 실패했습니다.", { kind: "error" }));
    setMenuOpen(false);
  };

  const copyPageContent = () => {
    if (!activeId) return;
    const page = pages[activeId];
    if (!page) return;
    void navigator.clipboard
      .writeText(pageDocToMarkdown(page.doc))
      .then(() => showToast("페이지 내용 복사 완료!", { kind: "success" }))
      .catch(() => showToast("페이지 내용 복사에 실패했습니다.", { kind: "error" }));
    setMenuOpen(false);
  };

  const handleDelete = () => {
    if (!activeId) return;
    setPageDeleteConfirmOpen(true);
    setMenuOpen(false);
  };

  const handleNavigationBack = () => {
    const prev = popNavigationBack();
    if (!prev) return;
    setActive(prev);
    setCurrentTabPage(prev);
  };

  // 마크다운 파일로 현재 페이지 내보내기
  const handleExportMarkdown = () => {
    if (!activeId) return;
    const page = pages[activeId];
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

  // 브라우저 인쇄 기능으로 PDF 내보내기
  const handleExportPdf = () => {
    window.print();
    setMenuOpen(false);
  };

  // HTML 파일로 현재 페이지 내보내기
  const handleExportHtml = () => {
    if (!activeId) return;
    const page = pages[activeId];
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

  // 데이터베이스 관리 팝업과 동일한 로직 — 스토어 함수로 기존 페이지 조회 (중복 생성 방지)
  const openDatabase = (databaseId: string) => {
    setActive(null);
    setCurrentTabDatabase(databaseId);
  };

  return (
    <header className="relative z-[350] flex h-10 shrink-0 items-center gap-2 border-b border-zinc-200 bg-white px-4 text-sm dark:border-zinc-800 dark:bg-zinc-950">
      {showPreviousButton ? (
        <button
          type="button"
          onClick={handleNavigationBack}
          title="이전 페이지로 이동"
          className="inline-flex h-7 min-w-0 items-center gap-0.5 rounded-md px-1.5 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <ChevronLeft size={16} className="shrink-0" />
          <span className="truncate">이전 페이지</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => navigateToParentPage()}
          disabled={!canGoBack}
          className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-30 disabled:cursor-default dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          aria-label="상위 페이지로 이동"
          title="상위 페이지로 이동 (루트에서는 비활성)"
        >
          <ChevronLeft size={16} />
        </button>
      )}
      <div className="flex flex-1 items-center gap-1 overflow-hidden text-xs text-zinc-500 dark:text-zinc-400">
        {hasNavTrail ? (
          <>
            {backStack.map((pageId, idx) => {
              const p = pages[pageId];
              return (
                <span key={pageId} className="flex items-center gap-1">
                  {idx > 0 && <ChevronRight size={10} className="shrink-0 text-zinc-300" />}
                  <button
                    type="button"
                    onClick={() => {
                      const id = jumpToNavigation(idx);
                      if (id) { setActive(id); setCurrentTabPage(id); }
                    }}
                    className="flex max-w-28 items-center gap-1 truncate rounded px-1 py-0.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                  >
                    {p?.icon && (
                      <PageIconDisplay icon={p.icon} size="sm" className="shrink-0" />
                    )}
                    <span className="truncate">{p?.title || "제목 없음"}</span>
                  </button>
                </span>
              );
            })}
            <ChevronRight size={10} className="shrink-0 text-zinc-300" />
            <span className="max-w-28 truncate text-zinc-900 dark:text-zinc-100">
              {activeId ? (pages[activeId]?.title || "제목 없음") : ""}
            </span>
            <button
              type="button"
              onClick={() => clearNavigationBack()}
              className="ml-1 shrink-0 rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              title="히스토리 닫기"
            >
              <X size={10} />
            </button>
          </>
        ) : breadcrumb.length === 0 ? (
          <span>페이지를 선택하거나 새로 만드세요</span>
        ) : breadcrumb.length === 1 && breadcrumb[0]?.id === activeId ? null : (
          breadcrumb.map((node, idx) => (
            <div key={node.id} className="flex items-center gap-1">
              {idx > 0 && (
                <ChevronRight size={12} className="text-zinc-300" />
              )}
              <button
                type="button"
                onClick={() => {
                  if (node.dbId) {
                    openDatabase(node.dbId);
                  } else {
                    setActive(node.id);
                    setCurrentTabPage(node.id);
                  }
                }}
                className={[
                  "flex items-center gap-1 truncate rounded px-1.5 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800",
                  idx === breadcrumb.length - 1
                    ? "text-zinc-900 dark:text-zinc-100"
                    : "",
                ].join(" ")}
              >
                {node.icon ? (
                  <PageIconDisplay
                    icon={node.icon}
                    size="sm"
                    className="shrink-0"
                  />
                ) : (
                  <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-zinc-400">
                    ·
                  </span>
                )}
                <span className="max-w-32 truncate">
                  {node.title || "제목 없음"}
                </span>
              </button>
            </div>
          ))
        )}
      </div>
      {!sidebarCollapsed ? (
        <div className="flex shrink-0 items-center lg:hidden">
          <NotificationBell />
        </div>
      ) : null}
      <div className="flex items-center gap-1">
        {activeId && (
          <>
          {showSubpageTree && (
            <button
              ref={subpagePopover.buttonRef}
              type="button"
              onClick={() => subpagePopover.toggle(280)}
              className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              aria-label="페이지 트리"
              title="페이지 트리"
            >
              <FolderTree size={16} />
            </button>
          )}
          <button
            type="button"
            onClick={() => toggleFullWidthForPage(activeId)}
            className={[
              "rounded-md p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800",
              fullWidth
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100",
            ].join(" ")}
            aria-label={
              fullWidth ? "전체 너비 보기 끄기" : "전체 너비 보기 켜기"
            }
            aria-pressed={fullWidth}
            title={
              fullWidth
                ? "전체 너비 보기 끄기 (좁은 본문)"
                : "전체 너비 보기 켜기"
            }
          >
            <ArrowLeftRight size={16} strokeWidth={fullWidth ? 2.25 : 2} />
          </button>
          <button
            type="button"
            onClick={copyPageLink}
            className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label="링크 복사"
            title="링크 복사"
          >
            <Link2 size={16} />
          </button>
          {/* 페이지 내용 복사·복제·이동·버전 히스토리는 개별 아이콘 대신 "..." 메뉴에서만 제공한다. */}
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              aria-label="페이지 메뉴"
              title="페이지 메뉴"
            >
              <MoreHorizontal size={16} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={fullWidth}
                  title={
                    fullWidth
                      ? "전체 너비 보기 끄기 (좁은 본문)"
                      : "전체 너비 보기 켜기"
                  }
                  onClick={() => {
                    toggleFullWidthForPage(activeId);
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <ArrowLeftRight
                    size={16}
                    className={
                      fullWidth
                        ? "size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                        : `${MENU_ITEM_ICON}`
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
                  <span className="min-w-0 flex-1">
                    마크다운 내보내기
                  </span>
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
          </>
        )}
      </div>
      <PageHistoryPreviewDialog
        open={historyDialogOpen}
        pageId={activeId}
        workspaceId={activeWorkspaceId}
        onClose={() => setHistoryDialogOpen(false)}
      />
      <PageCopyToWorkspaceDialog
        pageId={copyToWorkspaceOpen ? activeId : null}
        onClose={() => setCopyToWorkspaceOpen(false)}
      />
      <PageMoveDialog
        pageId={moveDialogOpen ? activeId : null}
        onClose={() => setMoveDialogOpen(false)}
      />
      <SimpleConfirmDialog
        open={pageDeleteConfirmOpen}
        title="페이지 삭제"
        message="이 페이지를 삭제할까요? 이 작업은 되돌릴 수 없습니다."
        confirmLabel="삭제"
        danger
        onCancel={() => setPageDeleteConfirmOpen(false)}
        onConfirm={() => {
          if (activeId) deletePage(activeId);
          setPageDeleteConfirmOpen(false);
        }}
      />
      {subpagePopover.open && subpagePopover.coords && activeId && createPortal(
        <div
          ref={subpagePopover.popoverRef}
          style={{ position: "fixed", top: subpagePopover.coords.top, left: subpagePopover.coords.left, width: 280, zIndex: 9999 }}
          className="rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          <PageSubpageTree currentPageId={activeId} className="px-2 pb-3 pt-1" hideHeader />
        </div>,
        document.body,
      )}
    </header>
  );
}
