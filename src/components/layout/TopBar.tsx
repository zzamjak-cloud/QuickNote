import { ChevronRight, Moon, Sun, MoreHorizontal, Trash2, Check, Minus } from "lucide-react";
import { pageDocToMarkdown } from "../../lib/export/pageToMarkdown";
import { useState, useEffect, useRef } from "react";
import type { Page } from "../../types/page";
import { useSettingsStore } from "../../store/settingsStore";
import { usePageStore } from "../../store/pageStore";
import { useHistoryStore } from "../../store/historyStore";
import { SimpleConfirmDialog } from "../ui/SimpleConfirmDialog";
import { useHistorySelection } from "../history/useHistorySelection";
import { PageMoveDialog } from "./PageMoveDialog";
import { UserMenu } from "../auth/UserMenu";

export function TopBar() {
  const darkMode = useSettingsStore((s) => s.darkMode);
  const toggleDarkMode = useSettingsStore((s) => s.toggleDarkMode);
  const fullWidth = useSettingsStore((s) => s.fullWidth);
  const toggleFullWidth = useSettingsStore((s) => s.toggleFullWidth);
  const activeId = usePageStore((s) => s.activePageId);
  const pages = usePageStore((s) => s.pages);
  const setActive = usePageStore((s) => s.setActivePage);
  const duplicatePage = usePageStore((s) => s.duplicatePage);
  const deletePage = usePageStore((s) => s.deletePage);
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

  const breadcrumb: { id: string; title: string; icon: string | null }[] = [];
  if (activeId) {
    let cursor: string | null = activeId;
    while (cursor !== null) {
      const page: Page | undefined = pages[cursor];
      if (!page) break;
      breadcrumb.unshift({ id: page.id, title: page.title, icon: page.icon });
      cursor = page.parentId;
    }
  }

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
        void navigator.clipboard.writeText(`quicknote://page/${activeId}`);
        setMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId]);

  const handleDuplicate = () => {
    if (!activeId) return;
    const newId = duplicatePage(activeId);
    if (newId) setActive(newId);
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

  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b border-zinc-200 bg-white px-4 text-sm dark:border-zinc-800 dark:bg-zinc-950">
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
                onClick={() => setActive(node.id)}
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
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={toggleDarkMode}
          className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          aria-label="다크 모드 토글"
          title="다크 모드 토글"
        >
          {darkMode ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <UserMenu />
        {activeId && (
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
              <div className="absolute right-0 top-full z-50 mt-1 w-52 rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(
                      `quicknote://page/${activeId}`
                    );
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span>링크 복사</span>
                  <span className="text-xs text-zinc-400">⌘L</span>
                </button>
                <button
                  type="button"
                  onClick={handleDuplicate}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span>페이지 복제</span>
                  <span className="text-xs text-zinc-400">⌘D</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    toggleFullWidth();
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span>전체 너비</span>
                  <span className="text-xs text-zinc-400">
                    {fullWidth ? "✓" : ""}
                  </span>
                </button>
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
                <hr className="my-1 border-zinc-200 dark:border-zinc-700" />
                <button
                  type="button"
                  onClick={handleExportMarkdown}
                  className="flex w-full items-center px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  마크다운(.md)으로 내보내기
                </button>
                <button
                  type="button"
                  onClick={handleExportPdf}
                  className="flex w-full items-center px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  PDF로 내보내기
                </button>
                <hr className="my-1 border-zinc-200 dark:border-zinc-700" />
                <button
                  type="button"
                  onClick={handleDelete}
                  className="flex w-full items-center px-3 py-2 text-left text-sm text-red-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  페이지 삭제
                </button>
              </div>
            )}
          </div>
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
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => {
                      const targetEventId = entry.eventIds[entry.eventIds.length - 1];
                      if (targetEventId) {
                        restorePageFromHistoryEvent(activeId, targetEventId);
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
