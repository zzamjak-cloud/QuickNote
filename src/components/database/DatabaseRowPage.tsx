import { useEffect, useRef, useState } from "react";
import { ArrowLeft, MoreHorizontal, Star, Trash2, Check, Minus } from "lucide-react";
import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useHistoryStore } from "../../store/historyStore";
import { useUiStore } from "../../store/uiStore";
import { Editor } from "../editor/Editor";
import { IconPicker } from "../common/IconPicker";
import { DatabasePropertyPanel } from "./DatabasePropertyPanel";
import { useHistorySelection } from "../history/useHistorySelection";
import { SimpleConfirmDialog } from "../ui/SimpleConfirmDialog";
import { SimpleAlertDialog } from "../ui/SimpleAlertDialog";
import { PageMoveDialog } from "../layout/PageMoveDialog";
import { useMemberStore } from "../../store/memberStore";
import { formatPageHistoryEditorLine } from "../../lib/historyEditorLabel";

export function DatabaseRowPage({ pageId }: { pageId: string }) {
  const page = usePageStore((s) => s.pages[pageId]);
  const renamePage = usePageStore((s) => s.renamePage);
  const setIcon = usePageStore((s) => s.setIcon);
  const setActivePage = usePageStore((s) => s.setActivePage);
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);
  const favoritePageIds = useSettingsStore((s) => s.favoritePageIds);
  const toggleFavoritePage = useSettingsStore((s) => s.toggleFavoritePage);
  const getRowBackTarget = useUiStore((s) => s.getRowBackTarget);
  const clearRowBackTarget = useUiStore((s) => s.clearRowBackTarget);
  const databaseId = page?.databaseId;
  const bundle = useDatabaseStore((s) => (databaseId ? s.databases[databaseId] : undefined));
  const restorePageFromHistoryEvent = usePageStore(
    (s) => s.restorePageFromHistoryEvent,
  );
  const pageHistoryTimeline = useHistoryStore((s) => s.getPageTimeline(pageId));
  const deletePageHistoryEvents = useHistoryStore((s) => s.deletePageHistoryEvents);
  const members = useMemberStore((s) => s.members);
  const me = useMemberStore((s) => s.me);

  const [titleDraft, setTitleDraft] = useState(page?.title ?? "");
  const [menuOpen, setMenuOpen] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [iconAlert, setIconAlert] = useState<string | null>(null);
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
  }, [page?.title, pageId]);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  if (!page || !databaseId || !bundle) {
    return (
      <div className="p-8 text-sm text-zinc-500">
        행 페이지를 찾을 수 없습니다.
      </div>
    );
  }

  const goBackToDatabase = () => {
    const backTarget = getRowBackTarget(pageId);
    if (backTarget && usePageStore.getState().pages[backTarget]) {
      setActivePage(backTarget);
      setCurrentTabPage(backTarget);
      clearRowBackTarget(pageId);
      return;
    }
    // 원본 기록이 없으면 안전한 폴백: 첫 일반 페이지.
    const firstNormal = Object.values(usePageStore.getState().pages)
      .filter((p) => p.databaseId == null)
      .sort((a, b) => a.order - b.order)[0];
    setActivePage(firstNormal?.id ?? null);
    setCurrentTabPage(firstNormal?.id ?? null);
  };

  return (
    <div className="mx-auto max-w-[840px] px-12 py-8">
      <div className="mb-6 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={goBackToDatabase}
          className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          <ArrowLeft size={12} /> {bundle.meta.title}
        </button>
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label="항목 페이지 메뉴"
            title="항목 페이지 메뉴"
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
      </div>

      <div className="mb-4 flex items-center gap-2">
        <IconPicker
          current={page.icon}
          onChange={(icon) => setIcon(pageId, icon)}
          onUploadMessage={(msg) => setIconAlert(msg)}
        />
        <input
          type="text"
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={() => renamePage(pageId, titleDraft.trim() || "제목 없음")}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          placeholder="제목 없음"
          className="min-w-0 flex-1 bg-transparent text-3xl font-semibold outline-none placeholder:text-zinc-400"
        />
        <button
          type="button"
          onClick={() => toggleFavoritePage(pageId)}
          className="shrink-0 rounded-md p-2 text-zinc-400 hover:bg-zinc-100 hover:text-amber-500 dark:hover:bg-zinc-800 dark:hover:text-amber-400"
          aria-label={
            favoritePageIds.includes(pageId) ? "즐겨찾기 해제" : "즐겨찾기"
          }
          aria-pressed={favoritePageIds.includes(pageId)}
          title="즐겨찾기"
        >
          <Star
            size={22}
            strokeWidth={1.75}
            className={
              favoritePageIds.includes(pageId)
                ? "fill-amber-400 text-amber-500"
                : ""
            }
          />
        </button>
      </div>

      <DatabasePropertyPanel databaseId={databaseId} pageId={pageId} />

      <Editor pageId={pageId} bodyOnly />
      <PageMoveDialog
        pageId={moveDialogOpen ? pageId : null}
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
            aria-labelledby="qn-row-page-history-title"
            className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2
                id="qn-row-page-history-title"
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
                        restorePageFromHistoryEvent(pageId, targetEventId);
                      }
                      setHistoryDialogOpen(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        const targetEventId = entry.eventIds[entry.eventIds.length - 1];
                        if (targetEventId) {
                          restorePageFromHistoryEvent(pageId, targetEventId);
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
      <SimpleAlertDialog
        open={iconAlert !== null}
        message={iconAlert ?? ""}
        onClose={() => setIconAlert(null)}
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
          if (deleteTarget) {
            deletePageHistoryEvents(pageId, deleteTarget.eventIds);
          }
          setDeleteConfirmOpen(false);
          setDeleteTarget(null);
          clearTimelineSelection();
        }}
      />
    </div>
  );
}
