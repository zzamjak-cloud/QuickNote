import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent,
} from "react";
import { useNavigationHistoryStore } from "../../store/navigationHistoryStore";
import { useShallow } from "zustand/react/shallow";
import { Check, Minus, Trash2 } from "lucide-react";
import { startBlockNativeDrag } from "../../lib/startBlockNativeDrag";
import { listDatabases, useDatabaseStore } from "../../store/databaseStore";
import { usePageStore } from "../../store/pageStore";
import { useSettingsStore } from "../../store/settingsStore";
import type {
  DatabaseLayout,
  DatabasePanelState,
  ViewKind,
} from "../../types/database";
import { parseDatabasePanelStateJson } from "../../lib/schemas/panelStateSchema";
import { DatabaseTableView } from "./views/DatabaseTableView";
import { DatabaseKanbanView } from "./views/DatabaseKanbanView";
import { DatabaseGalleryView } from "./views/DatabaseGalleryView";
import { DatabaseTimelineView } from "./views/DatabaseTimelineView";
import { DatabaseListView } from "./views/DatabaseListView";
import { DatabaseToolbarControls } from "./DatabaseToolbarControls";
import { scheduleEditorMutation } from "../../lib/pm/scheduleEditorMutation";
import { DatabaseBlockBinding } from "./DatabaseBlockBinding";
import { DatabaseBlockDataArea } from "./DatabaseBlockDataArea";
import { DatabaseBlockFullPageHeader } from "./DatabaseBlockFullPageHeader";
import { DatabaseBlockInlineHeader } from "./DatabaseBlockInlineHeader";
import { isLCSchedulerDatabaseId } from "../../lib/scheduler/database";
import { DatabaseBlockLinkExistingPanel } from "./DatabaseBlockLinkExistingPanel";
import { DatabaseDeleteConfirmDialog } from "./DatabaseDeleteConfirmDialog";
import {
  repairDbHistoryBaselineIfNeeded,
  useHistoryStore,
} from "../../store/historyStore";
import { useHistorySelection } from "../history/useHistorySelection";
import { SimpleConfirmDialog } from "../ui/SimpleConfirmDialog";
import { useDatabaseViewPrefsStore } from "../../store/databaseViewPrefsStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useMemberStore } from "../../store/memberStore";
import { formatPageHistoryEditorLine } from "../../lib/historyEditorLabel";

export function DatabaseBlockView(props: NodeViewProps) {
  const { editor, node, getPos, updateAttributes, deleteNode } = props;
  const databaseId = String(node.attrs.databaseId ?? "");
  const readOnlyTitleAttr = Boolean(node.attrs.readOnlyTitle);
  const layout = (node.attrs.layout ?? "inline") as DatabaseLayout;
  const rawView = String(node.attrs.view ?? "table");
  const view = rawView as ViewKind;
  const panelStateRaw = String(node.attrs.panelState ?? "{}");
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  // members 는 큰 객체 — useShallow 로 얕은 비교해 무관 멤버 변경 시 리렌더 방지
  const { members, me } = useMemberStore(
    useShallow((s) => ({ members: s.members, me: s.me })),
  );
  const panelState = useDatabaseViewPrefsStore((s) =>
    databaseId
      ? s.getPanelState(databaseId, panelStateRaw)
      : parseDatabasePanelStateJson(panelStateRaw),
  );
  void currentWorkspaceId;
  const panelStateRef = useRef(panelState);
  panelStateRef.current = panelState;
  const patchLocalPanelState = useDatabaseViewPrefsStore((s) => s.patchPanelState);

  const bundle = useDatabaseStore((s) => s.databases[databaseId]);
  const hasDatabaseId = databaseId.length > 0;
  const needsBinding = !hasDatabaseId;
  const bundleGone = hasDatabaseId && !bundle;
  const isProtectedDatabase = isLCSchedulerDatabaseId(databaseId);

  const setDatabaseTitle = useDatabaseStore((s) => s.setDatabaseTitle);
  const deleteDatabaseFromStore = useDatabaseStore((s) => s.deleteDatabase);
  const renamePage = usePageStore((s) => s.renamePage);
  const activePageId = usePageStore((s) => s.activePageId);
  const setActivePageNav = usePageStore((s) => s.setActivePage);
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);

  const dbHomePageId = usePageStore((s) =>
    databaseId.trim() ? s.findFullPagePageIdForDatabase(databaseId) : null,
  );

  const inlineTitleLocked =
    isProtectedDatabase ||
    (layout === "inline" && (readOnlyTitleAttr || dbHomePageId != null));

  // 내비게이션 히스토리 (인라인→전체 DB 전환 시 뒤로가기 지원).
  const pushBack = useNavigationHistoryStore((s) => s.pushBack);
  const popBack = useNavigationHistoryStore((s) => s.popBack);
  const previousPageId = useNavigationHistoryStore((s) => s.peekBack());

  const openDbHomePage = useCallback(
    (pageId: string) => {
      // 현재 활성 페이지를 히스토리에 쌓은 후 이동.
      if (activePageId) pushBack(activePageId);
      setActivePageNav(pageId);
      setCurrentTabPage(pageId);
    },
    [activePageId, pushBack, setActivePageNav, setCurrentTabPage],
  );

  // 더보기 — 추가로 표시할 행 수.
  const [extraRows, setExtraRows] = useState(0);

  const displayDbTitle = bundle?.meta.title ?? "데이터베이스";
  const deleteConfirmPhrase = useMemo(() => {
    const name = displayDbTitle.trim() || "데이터베이스";
    return `${name} 삭제`;
  }, [displayDbTitle]);

  const [titleDraft, setTitleDraft] = useState(displayDbTitle);
  useEffect(() => {
    setTitleDraft(displayDbTitle);
  }, [displayDbTitle, databaseId]);

  // db.create 없이 패치만 있으면 버전 기록 UI가 비어 보인다 — 고아 체인 복구 후 베이스라인 심기.
  useEffect(() => {
    if (!hasDatabaseId || !bundle) return;
    repairDbHistoryBaselineIfNeeded(databaseId, structuredClone(bundle));
  }, [hasDatabaseId, databaseId, bundle]);

  const commitDbTitle = () => {
    if (!hasDatabaseId) return;
    const t = titleDraft.trim() || "제목 없음";
    const ok = setDatabaseTitle(databaseId, t);
    if (!ok) {
      alert("이미 사용 중인 데이터베이스 이름입니다.");
      setTitleDraft(displayDbTitle);
      return;
    }
    if (layout === "fullPage" && activePageId) {
      renamePage(activePageId, t);
    }
  };

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletePhraseDraft, setDeletePhraseDraft] = useState("");
  const [dbHistoryDialogOpen, setDbHistoryDialogOpen] = useState(false);
  const [dbHistoryDeleteOpen, setDbHistoryDeleteOpen] = useState(false);
  const [dbPermanentDeleteOpen, setDbPermanentDeleteOpen] = useState(false);
  const [dbHistoryDeleteTarget, setDbHistoryDeleteTarget] = useState<{
    label: string;
    eventIds: string[];
  } | null>(null);
  const dbHistoryTimeline = useHistoryStore((s) =>
    hasDatabaseId ? s.getDbTimeline(databaseId) : [],
  );
  const deleteDbHistoryEvents = useHistoryStore((s) => s.deleteDbHistoryEvents);
  const dbTimelineIds = dbHistoryTimeline.map((e) => e.id);
  const {
    selectedIds: selectedDbTimelineIds,
    toggleOne: toggleDbTimelineOne,
    toggleAll: toggleDbTimelineAll,
    clearSelection: clearDbTimelineSelection,
  } = useHistorySelection(dbTimelineIds);
  const selectedDbTimelineEntries = dbHistoryTimeline.filter((e) =>
    selectedDbTimelineIds.has(e.id),
  );
  const selectedDbEventIds = selectedDbTimelineEntries.flatMap((e) => e.eventIds);

  const openDeleteDatabaseModal = () => {
    if (isProtectedDatabase) return;
    setDeletePhraseDraft("");
    setDeleteModalOpen(true);
  };

  const closeDeleteDatabaseModal = () => {
    setDeleteModalOpen(false);
    setDeletePhraseDraft("");
  };

  const executeDeleteDatabasePermanently = () => {
    if (!hasDatabaseId) return;
    if (isProtectedDatabase) return;
    if (deletePhraseDraft.trim() !== deleteConfirmPhrase) {
      alert(
        `다음 문구를 정확히 입력하세요:\n「${deleteConfirmPhrase}」`,
      );
      return;
    }
    deleteDatabaseFromStore(databaseId);
    if (layout === "fullPage" && activePageId) {
      usePageStore.getState().deletePage(activePageId);
    } else {
      scheduleEditorMutation(() => {
        deleteNode();
      });
    }
    closeDeleteDatabaseModal();
  };

  const [linkOpen, setLinkOpen] = useState(false);

  type InlineBindingStep = "choose" | "new" | "link";
  const [inlineBindingStep, setInlineBindingStep] =
    useState<InlineBindingStep>("choose");
  const [linkPickerQuery, setLinkPickerQuery] = useState("");
  const [linkPickerHighlight, setLinkPickerHighlight] = useState(0);
  const linkPickerListBaseId = useId();

  const setPanelState = useCallback(
    (patch: Partial<DatabasePanelState>) => {
      if (!databaseId) return;
      const next = { ...panelStateRef.current, ...patch };
      panelStateRef.current = next;
      patchLocalPanelState(databaseId, patch, panelStateRaw);
    },
    [databaseId, panelStateRaw, patchLocalPanelState],
  );

  const setView = useCallback(
    (v: ViewKind) => {
      scheduleEditorMutation(() => {
        updateAttributes({ view: v });
      });
    },
    [updateAttributes],
  );

  const databasesList = useDatabaseStore(listDatabases);

  const linkPickerFiltered = useMemo(() => {
    const q = linkPickerQuery.trim().toLowerCase();
    if (!q) return databasesList;
    return databasesList.filter((d) =>
      d.meta.title.toLowerCase().includes(q),
    );
  }, [databasesList, linkPickerQuery]);

  useEffect(() => {
    if (inlineBindingStep !== "link") return;
    setLinkPickerHighlight((prev) => {
      const n = linkPickerFiltered.length;
      if (n === 0) return -1;
      if (prev < 0) return 0;
      return Math.min(prev, n - 1);
    });
  }, [inlineBindingStep, linkPickerFiltered]);

  useEffect(() => {
    if (inlineBindingStep !== "link" || linkPickerHighlight < 0) return;
    const el = document.getElementById(
      `${linkPickerListBaseId}-opt-${linkPickerHighlight}`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [inlineBindingStep, linkPickerHighlight, linkPickerListBaseId]);

  const bindToExistingDatabase = useCallback(
    (id: string) => {
      if (!id) return;
      const linked = useDatabaseStore.getState().databases[id];
      scheduleEditorMutation(() => {
        updateAttributes(
          layout === "fullPage"
            ? { databaseId: id }
            : { databaseId: id, readOnlyTitle: true },
        );
      });
      if (layout === "fullPage" && activePageId && linked) {
        renamePage(activePageId, linked.meta.title);
      }
      setLinkOpen(false);
    },
    [layout, activePageId, updateAttributes, renamePage],
  );

  const createNewDatabaseAndBind = useCallback(() => {
    const id = useDatabaseStore.getState().createDatabase();
    const linked = useDatabaseStore.getState().databases[id];
    scheduleEditorMutation(() => {
      updateAttributes({ databaseId: id, readOnlyTitle: false });
    });
    if (layout === "fullPage" && activePageId && linked) {
      renamePage(activePageId, linked.meta.title);
    }
    setLinkOpen(false);
  }, [layout, activePageId, updateAttributes, renamePage]);

  const onLinkPickerKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.nativeEvent.isComposing || e.key === "Process") return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setLinkPickerHighlight((h) => {
          const n = linkPickerFiltered.length;
          if (n === 0) return -1;
          if (h < 0) return 0;
          return Math.min(h + 1, n - 1);
        });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setLinkPickerHighlight((h) => {
          const n = linkPickerFiltered.length;
          if (n === 0) return -1;
          if (h <= 0) return 0;
          return h - 1;
        });
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const row = linkPickerFiltered[linkPickerHighlight];
        if (row) bindToExistingDatabase(row.id);
      }
    },
    [linkPickerFiltered, linkPickerHighlight, bindToExistingDatabase],
  );

  const onInlineTitleDragStart = useCallback(
    (e: ReactDragEvent<HTMLDivElement>) => {
      const pos = typeof getPos === "function" ? getPos() : null;
      if (pos == null || pos < 0) {
        e.preventDefault();
        return;
      }
      // 박스 드래그 selection 이 있을 수 있어 단일 블럭 이동 경로로 직접 진입
      e.stopPropagation();
      document.body.classList.add("quicknote-block-dragging");
      startBlockNativeDrag(editor, e.nativeEvent, pos, node);
    },
    [editor, getPos, node],
  );

  const onInlineTitleDragEnd = useCallback(() => {
    document.body.classList.remove("quicknote-block-dragging");
  }, []);

  const shellClass =
    layout === "fullPage"
      ? "my-4 w-[calc(100%+6rem)] max-w-none -mx-12"
      : "my-4";

  // fullPage는 제한 없이 전체 표시, inline은 itemLimit + extraRows 적용.
  const visibleRowLimit =
    layout === "fullPage"
      ? undefined
      : (panelState.itemLimit ?? 30) + extraRows;

  const activeViewComponent = useMemo(() => {
    if (!bundle) return null;
    switch (view) {
      case "table":
        return (
          <DatabaseTableView
            databaseId={databaseId}
            panelState={panelState}
            setPanelState={setPanelState}
            visibleRowLimit={visibleRowLimit}
            layout={layout}
          />
        );
      case "list":
        return (
          <DatabaseListView
            databaseId={databaseId}
            panelState={panelState}
            setPanelState={setPanelState}
            visibleRowLimit={visibleRowLimit}
          />
        );
      case "kanban":
        return (
          <DatabaseKanbanView
            databaseId={databaseId}
            panelState={panelState}
            setPanelState={setPanelState}
            visibleRowLimit={visibleRowLimit}
          />
        );
      case "gallery":
        return (
          <DatabaseGalleryView
            databaseId={databaseId}
            panelState={panelState}
            setPanelState={setPanelState}
            visibleRowLimit={visibleRowLimit}
          />
        );
      case "timeline":
        return (
          <DatabaseTimelineView
            databaseId={databaseId}
            panelState={panelState}
            setPanelState={setPanelState}
            visibleRowLimit={visibleRowLimit}
          />
        );
      default:
        return null;
    }
  }, [databaseId, bundle, layout, panelState, setPanelState, view, visibleRowLimit]);

  return (
    <NodeViewWrapper className="qn-database-block">
      <div
        className={shellClass}
        onMouseDown={(e) => {
          const t = e.target as HTMLElement;
          if (
            t.closest(
              "button, a[href], input, textarea, select, label",
            )
          ) {
            e.stopPropagation();
          }
        }}
      >
        {needsBinding ? (
          <DatabaseBlockBinding
            inlineBindingStep={inlineBindingStep}
            setInlineBindingStep={setInlineBindingStep}
            linkPickerQuery={linkPickerQuery}
            setLinkPickerQuery={setLinkPickerQuery}
            linkPickerHighlight={linkPickerHighlight}
            setLinkPickerHighlight={setLinkPickerHighlight}
            linkPickerListBaseId={linkPickerListBaseId}
            linkPickerFiltered={linkPickerFiltered}
            createNewDatabaseAndBind={createNewDatabaseAndBind}
            bindToExistingDatabase={bindToExistingDatabase}
            onLinkPickerKeyDown={onLinkPickerKeyDown}
          />
        ) : (
          <>
            {layout === "inline" ? (
              <DatabaseBlockInlineHeader
                displayDbTitle={displayDbTitle}
                titleDraft={titleDraft}
                onTitleDraftChange={setTitleDraft}
                onTitleCommit={commitDbTitle}
                inlineTitleLocked={inlineTitleLocked}
                dbHomePageId={dbHomePageId}
                onOpenDbHomePage={openDbHomePage}
                onOpenDbHistory={() => setDbHistoryDialogOpen(true)}
                onOpenLink={() => setLinkOpen((v) => !v)}
                onOpenDeleteModal={openDeleteDatabaseModal}
                deleteDisabled={isProtectedDatabase}
                onTitleDragStart={onInlineTitleDragStart}
                onTitleDragEnd={onInlineTitleDragEnd}
              />
            ) : (
              <DatabaseBlockFullPageHeader
                onOpenDbHistory={() => setDbHistoryDialogOpen(true)}
                onOpenDeleteModal={openDeleteDatabaseModal}
                deleteDisabled={isProtectedDatabase}
                hasPreviousPage={!!previousPageId}
                onGoBack={() => {
                  const prev = popBack();
                  if (prev) {
                    setActivePageNav(prev);
                    setCurrentTabPage(prev);
                  }
                }}
              />
            )}

            <DatabaseToolbarControls
              databaseId={databaseId}
              viewKind={view}
              view={view}
              onViewChange={setView}
              panelState={panelState}
              setPanelState={setPanelState}
              layout={layout}
            />

            {linkOpen && (
              <DatabaseBlockLinkExistingPanel
                databaseId={databaseId}
                databasesList={databasesList}
                onSelectExisting={bindToExistingDatabase}
              />
            )}

            <DatabaseBlockDataArea bundleGone={bundleGone}>
              {activeViewComponent}
            </DatabaseBlockDataArea>

            {/* 더보기 버튼 — 인라인 레이아웃에서 항목 수가 limit을 초과할 때 표시. */}
            {layout !== "fullPage" && bundle && (() => {
              const limit = (panelState.itemLimit ?? 30) + extraRows;
              const totalRows = bundle.rowPageOrder.length;
              if (totalRows <= limit) return null;
              return (
                <button
                  type="button"
                  onClick={() => setExtraRows((e) => e + 10)}
                  className="mt-1 w-full rounded-md border border-zinc-200 py-1.5 text-xs text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  + 더보기 ({totalRows - limit}개 남음)
                </button>
              );
            })()}
          </>
        )}
      </div>

      <DatabaseDeleteConfirmDialog
        open={deleteModalOpen}
        bundleTitle={bundle?.meta.title ?? "데이터베이스"}
        deleteConfirmPhrase={deleteConfirmPhrase}
        deletePhraseDraft={deletePhraseDraft}
        onDeletePhraseChange={setDeletePhraseDraft}
        onClose={closeDeleteDatabaseModal}
        onConfirmDelete={executeDeleteDatabasePermanently}
      />
      {dbHistoryDialogOpen && hasDatabaseId && (
        <div
          className="fixed inset-0 z-[420] flex items-center justify-center bg-black/45 p-4"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDbHistoryDialogOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="qn-db-history-title"
            className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2
                id="qn-db-history-title"
                className="text-sm font-semibold text-zinc-900 dark:text-zinc-100"
              >
                DB 버전 히스토리
              </h2>
              <button
                type="button"
                onClick={() => setDbHistoryDialogOpen(false)}
                className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                닫기
              </button>
            </div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    hasDatabaseId &&
                    useDatabaseStore.getState().restoreDatabaseFromLatestHistory(databaseId)
                  }
                  className="rounded border border-zinc-200 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  DB 최근 버전 복원
                </button>
                <button
                  type="button"
                  onClick={() => setDbPermanentDeleteOpen(true)}
                  disabled={isProtectedDatabase}
                  title={isProtectedDatabase ? "LC스케줄러 DB는 삭제할 수 없습니다." : undefined}
                  className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:border-red-900/40 dark:hover:bg-red-950/30"
                >
                  영구삭제
                </button>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => toggleDbTimelineAll()}
                  className="inline-flex items-center gap-1 rounded border border-zinc-200 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  {selectedDbTimelineIds.size > 0 &&
                  selectedDbTimelineIds.size === dbTimelineIds.length ? (
                    <Check size={12} />
                  ) : selectedDbTimelineIds.size > 0 ? (
                    <Minus size={12} />
                  ) : (
                    <span className="inline-block h-3 w-3 rounded-sm border border-zinc-400" />
                  )}
                  전체 선택
                </button>
                {selectedDbTimelineIds.size > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setDbHistoryDeleteTarget({
                        label: `${selectedDbTimelineIds.size}개 선택 항목`,
                        eventIds: selectedDbEventIds,
                      });
                      setDbHistoryDeleteOpen(true);
                    }}
                    className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-900/40 dark:hover:bg-red-950/30"
                  >
                    선택 삭제
                  </button>
                )}
              </div>
            </div>
            <div className="max-h-[55vh] overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-700">
              {dbHistoryTimeline.length === 0 ? (
                <div className="px-3 py-2 text-xs text-zinc-500">
                  버전 기록이 없습니다.
                </div>
              ) : (
                dbHistoryTimeline.slice(0, 100).map((entry, idx, arr) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => {
                      const targetEventId = entry.eventIds[entry.eventIds.length - 1];
                      if (targetEventId && hasDatabaseId) {
                        useDatabaseStore
                          .getState()
                          .restoreDatabaseFromHistoryEvent(databaseId, targetEventId);
                      }
                      setDbHistoryDialogOpen(false);
                    }}
                    className="flex w-full items-center justify-between gap-2 border-b border-zinc-100 px-3 py-2 text-left text-xs last:border-b-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleDbTimelineOne(entry.id, { shiftKey: e.shiftKey });
                      }}
                      className={[
                        "inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border",
                        selectedDbTimelineIds.has(entry.id)
                          ? "border-blue-500 bg-blue-500 text-white"
                          : "border-zinc-400",
                      ].join(" ")}
                      aria-label="히스토리 선택"
                    >
                      {selectedDbTimelineIds.has(entry.id) ? (
                        <Check size={10} strokeWidth={3} />
                      ) : null}
                    </button>
                    <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-200">
                      {`버전 ${arr.length - idx}`}
                    </span>
                    <span className="shrink-0 text-[11px] text-zinc-400">
                      {new Date(entry.endTs).toLocaleString()}
                    </span>
                    {(entry.lastEditedByName || entry.lastEditedByMemberId) && (
                      <span className="shrink-0 max-w-[80px] truncate text-[11px] text-zinc-400">
                        {formatPageHistoryEditorLine(entry, { members, me: me ?? null })}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDbHistoryDeleteTarget({
                          label: `버전 ${arr.length - idx}`,
                          eventIds: entry.eventIds,
                        });
                        setDbHistoryDeleteOpen(true);
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
        open={dbHistoryDeleteOpen}
        title="히스토리 항목 삭제"
        message={`"${dbHistoryDeleteTarget?.label ?? "선택한 항목"}" 히스토리를 삭제할까요?`}
        confirmLabel="삭제"
        danger
        onCancel={() => {
          setDbHistoryDeleteOpen(false);
          setDbHistoryDeleteTarget(null);
        }}
        onConfirm={() => {
          if (hasDatabaseId && dbHistoryDeleteTarget) {
            deleteDbHistoryEvents(databaseId, dbHistoryDeleteTarget.eventIds);
          }
          setDbHistoryDeleteOpen(false);
          setDbHistoryDeleteTarget(null);
          clearDbTimelineSelection();
        }}
      />
      <SimpleConfirmDialog
        open={dbPermanentDeleteOpen}
        title="데이터베이스 영구삭제"
        message="이 데이터베이스와 모든 히스토리를 완전히 삭제합니다. 복구가 불가능합니다. 계속할까요?"
        confirmLabel="영구삭제"
        danger
        onCancel={() => setDbPermanentDeleteOpen(false)}
        onConfirm={() => {
          if (hasDatabaseId && !isProtectedDatabase) {
            deleteDatabaseFromStore(databaseId);
            if (layout === "fullPage" && activePageId) {
              usePageStore.getState().deletePage(activePageId);
            } else {
              scheduleEditorMutation(() => deleteNode());
            }
          }
          setDbPermanentDeleteOpen(false);
          setDbHistoryDialogOpen(false);
        }}
      />
    </NodeViewWrapper>
  );
}
