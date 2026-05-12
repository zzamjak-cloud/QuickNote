import {
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  FileText,
  MoreHorizontal,
  Printer,
  Trash2,
  Check,
  Minus,
  Link2,
  Copy,
  CopyPlus,
  FolderInput,
  History,
} from "lucide-react";
import { pageDocToMarkdown } from "../../lib/export/pageToMarkdown";
import { buildQuickNotePageUrl } from "../../lib/navigation/quicknoteLinks";
import { emptyPanelState } from "../../types/database";

/** 페이지 메뉴 드롭다운 왼쪽 아이콘 공통 스타일 */
const MENU_ITEM_ICON =
  "size-4 shrink-0 text-zinc-500 dark:text-zinc-400";
import { useState, useEffect, useRef } from "react";
import type { Page } from "../../types/page";
import { useSettingsStore } from "../../store/settingsStore";
import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { useHistoryStore } from "../../store/historyStore";
import { useUiStore } from "../../store/uiStore";
import { NotificationBell } from "../notifications/NotificationBell";
import { SimpleConfirmDialog } from "../ui/SimpleConfirmDialog";
import { useHistorySelection } from "../history/useHistorySelection";
import { PageMoveDialog } from "./PageMoveDialog";
import { useMemberStore } from "../../store/memberStore";
import { formatPageHistoryEditorLine } from "../../lib/historyEditorLabel";

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
  const createPage = usePageStore((s) => s.createPage);
  const updateDoc = usePageStore((s) => s.updateDoc);
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);
  const showToast = useUiStore((s) => s.showToast);
  const restorePageFromHistoryEvent = usePageStore(
    (s) => s.restorePageFromHistoryEvent,
  );

  const [menuOpen, setMenuOpen] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    label: string;
    eventIds: string[];
  } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const pageHistoryTimeline = useHistoryStore((s) =>
    activeId ? s.getPageTimeline(activeId) : [],
  );
  const deletePageHistoryEvents = useHistoryStore((s) => s.deletePageHistoryEvents);
  const members = useMemberStore((s) => s.members);
  const me = useMemberStore((s) => s.me);
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
  const parentId = activePage?.parentId ?? null;
  const canGoBack =
    Boolean(activeId && parentId !== null && pages[parentId ?? ""]);

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
    deletePage(activeId);
    setMenuOpen(false);
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

  // 데이터베이스 관리 팝업과 동일한 로직 — 스토어 함수로 기존 페이지 조회 (중복 생성 방지)
  const openDatabase = (databaseId: string, title: string) => {
    const existingId = usePageStore
      .getState()
      .findFullPagePageIdForDatabase(databaseId);
    const pageId =
      existingId ??
      (() => {
        const id = createPage(title, null, { activate: false });
        updateDoc(id, {
          type: "doc",
          content: [
            {
              type: "databaseBlock",
              attrs: {
                databaseId,
                layout: "fullPage",
                view: "table",
                panelState: JSON.stringify(emptyPanelState()),
              },
            },
          ],
        });
        return id;
      })();
    setActive(pageId);
    setCurrentTabPage(pageId);
  };

  return (
    <header className="relative z-[350] flex h-10 shrink-0 items-center gap-2 border-b border-zinc-200 bg-white px-4 text-sm dark:border-zinc-800 dark:bg-zinc-950">
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
      <div className="flex flex-1 items-center gap-1 overflow-hidden text-xs text-zinc-500 dark:text-zinc-400">
        {breadcrumb.length === 0 ? (
          <span>페이지를 선택하거나 새로 만드세요</span>
        ) : (
          breadcrumb.map((node, idx) => (
            <div key={node.id} className="flex items-center gap-1">
              {idx > 0 && (
                <ChevronRight size={12} className="text-zinc-300" />
              )}
              <button
                type="button"
                onClick={() => {
                  if (node.dbId) {
                    openDatabase(node.dbId, node.title);
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
                <span>{node.icon ?? "·"}</span>
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
          <button
            type="button"
            onClick={copyPageContent}
            className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label="페이지 내용 복사"
            title="페이지 내용 복사"
          >
            <Copy size={16} />
          </button>
          <button
            type="button"
            onClick={handleDuplicate}
            className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label="페이지 복제"
            title="페이지 복제"
          >
            <CopyPlus size={16} />
          </button>
          <button
            type="button"
            onClick={() => setMoveDialogOpen(true)}
            className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label="다른 페이지로 이동"
            title="다른 페이지로 이동"
          >
            <FolderInput size={16} />
          </button>
          <button
            type="button"
            onClick={() => setHistoryDialogOpen(true)}
            className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label="버전 히스토리"
            title="버전 히스토리"
          >
            <History size={16} />
          </button>
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
                  <span className="shrink-0 text-xs text-zinc-400">⌘D</span>
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
                  <span className="min-w-0 flex-1">PDF로 내보내기</span>
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
      {historyDialogOpen && activeId && (
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
            aria-labelledby="qn-page-history-title"
            className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2
                id="qn-page-history-title"
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
                      if (targetEventId) {
                        restorePageFromHistoryEvent(activeId, targetEventId);
                      }
                      setHistoryDialogOpen(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        const targetEventId = entry.eventIds[entry.eventIds.length - 1];
                        if (targetEventId) {
                          restorePageFromHistoryEvent(activeId, targetEventId);
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
      <PageMoveDialog
        pageId={moveDialogOpen ? activeId : null}
        onClose={() => setMoveDialogOpen(false)}
      />
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
          if (activeId && deleteTarget) {
            deletePageHistoryEvents(activeId, deleteTarget.eventIds);
          }
          setDeleteConfirmOpen(false);
          setDeleteTarget(null);
          clearTimelineSelection();
        }}
      />
    </header>
  );
}
