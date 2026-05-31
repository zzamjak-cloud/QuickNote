import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";
import {
  lazy,
  Suspense,
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
const DatabaseTableView = lazy(() =>
  import("./views/DatabaseTableView").then((m) => ({ default: m.DatabaseTableView })),
);
const DatabaseKanbanView = lazy(() =>
  import("./views/DatabaseKanbanView").then((m) => ({ default: m.DatabaseKanbanView })),
);
const DatabaseGalleryView = lazy(() =>
  import("./views/DatabaseGalleryView").then((m) => ({ default: m.DatabaseGalleryView })),
);
const DatabaseTimelineView = lazy(() =>
  import("./views/DatabaseTimelineView").then((m) => ({ default: m.DatabaseTimelineView })),
);
const DatabaseListView = lazy(() =>
  import("./views/DatabaseListView").then((m) => ({ default: m.DatabaseListView })),
);
import { DatabaseToolbarControls } from "./DatabaseToolbarControls";
import { scheduleEditorMutation } from "../../lib/pm/scheduleEditorMutation";
import { DatabaseBlockBinding } from "./DatabaseBlockBinding";
import { DatabaseBlockDataArea } from "./DatabaseBlockDataArea";
import { DatabaseBlockFullPageHeader } from "./DatabaseBlockFullPageHeader";
import { DatabaseBlockInlineHeader } from "./DatabaseBlockInlineHeader";
import { isProtectedDatabaseId } from "../../lib/scheduler/database";
import { DatabaseDeleteConfirmDialog } from "./DatabaseDeleteConfirmDialog";
import {
  repairDbHistoryBaselineIfNeeded,
} from "../../store/historyStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { refreshWorkspaceSnapshot } from "../../lib/sync/workspaceSwitch";
import { DatabaseBlockHistoryDialog } from "./DatabaseBlockHistoryDialog";
import { DatabaseBlockLinkExistingDialog } from "./DatabaseBlockLinkExistingDialog";
import { useMemberStore } from "../../store/memberStore";
import {
  makeInlineControlsPrefsKey,
  useDatabaseInlineUiPrefsStore,
} from "../../store/databaseInlineUiPrefsStore";

export function DatabaseBlockView(props: NodeViewProps) {
  const { editor, node, getPos, updateAttributes, deleteNode } = props;
  const databaseId = String(node.attrs.databaseId ?? "");
  const readOnlyTitleAttr = Boolean(node.attrs.readOnlyTitle);
  const layout = (node.attrs.layout ?? "inline") as DatabaseLayout;
  const rawView = String(node.attrs.view ?? "table");
  const view = rawView as ViewKind;
  const panelStateRaw = String(node.attrs.panelState ?? "{}");
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const currentMemberId = useMemberStore((s) => s.me?.memberId ?? null);
  const panelState = parseDatabasePanelStateJson(panelStateRaw);
  const isInsidePeek = useMemo(
    () => Boolean(editor?.view?.dom?.closest("[data-qn-peek-editor='true']")),
    [editor],
  );
  const panelStateRef = useRef(panelState);
  panelStateRef.current = panelState;

  const bundle = useDatabaseStore((s) => s.databases[databaseId]);
  const hasDatabaseId = databaseId.length > 0;
  const needsBinding = !hasDatabaseId;
  const bundleGone = hasDatabaseId && !bundle;
  const isProtectedDatabase = isProtectedDatabaseId(databaseId);

  const setDatabaseTitle = useDatabaseStore((s) => s.setDatabaseTitle);
  const deleteDatabaseFromStore = useDatabaseStore((s) => s.deleteDatabase);
  const renamePage = usePageStore((s) => s.renamePage);
  const activePageId = usePageStore((s) => s.activePageId);
  const setActivePageNav = usePageStore((s) => s.setActivePage);
  const setCurrentTabDatabase = useSettingsStore((s) => s.setCurrentTabDatabase);

  const inlineTitleLocked =
    isProtectedDatabase ||
    (layout === "inline" && readOnlyTitleAttr);

  // 내비게이션 히스토리 (인라인→전체 DB 전환 시 뒤로가기 지원).
  const pushBack = useNavigationHistoryStore((s) => s.pushBack);

  const openDbHomePage = useCallback(
    (_pageId: string | null) => {
      if (activePageId) pushBack(activePageId);
      setActivePageNav(null);
      setCurrentTabDatabase(databaseId);
    },
    [activePageId, databaseId, pushBack, setActivePageNav, setCurrentTabDatabase],
  );

  // 더보기 — 추가로 표시할 행 수.
  const [extraRows, setExtraRows] = useState(0);

  const displayDbTitle = bundle?.meta.title ?? "데이터베이스";
  const deleteConfirmPhrase = useMemo(() => {
    const name = displayDbTitle.trim() || "데이터베이스";
    return `${name} 삭제`;
  }, [displayDbTitle]);

  // db.create 없이 패치만 있으면 버전 기록 UI가 비어 보인다 — 고아 체인 복구 후 베이스라인 심기.
  useEffect(() => {
    if (!hasDatabaseId || !bundle) return;
    repairDbHistoryBaselineIfNeeded(databaseId, structuredClone(bundle));
  }, [hasDatabaseId, databaseId, bundle]);

  const commitDbTitle = (draft: string) => {
    if (!hasDatabaseId) return false;
    const t = draft.trim() || "제목 없음";
    const ok = setDatabaseTitle(databaseId, t);
    if (!ok) {
      alert("이미 사용 중인 데이터베이스 이름입니다.");
      return false;
    }
    if (layout === "fullPage" && activePageId) {
      renamePage(activePageId, t);
    }
    return true;
  };

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletePhraseDraft, setDeletePhraseDraft] = useState("");
  const [dbHistoryDialogOpen, setDbHistoryDialogOpen] = useState(false);
  const inlineControlsCollapsedByKey = useDatabaseInlineUiPrefsStore(
    (s) => s.inlineControlsCollapsedByKey,
  );
  const setInlineControlsCollapsed = useDatabaseInlineUiPrefsStore(
    (s) => s.setInlineControlsCollapsed,
  );

  const inlineControlsPrefsKey = useMemo(() => {
    if (!databaseId) return null;
    return makeInlineControlsPrefsKey({
      workspaceId: currentWorkspaceId,
      memberId: currentMemberId,
      databaseId,
    });
  }, [currentWorkspaceId, currentMemberId, databaseId]);

  const inlineControlsCollapsed = inlineControlsPrefsKey
    ? (inlineControlsCollapsedByKey[inlineControlsPrefsKey] ?? false)
    : false;

  const openDeleteDatabaseModal = () => {
    if (isProtectedDatabase) return;
    setDeletePhraseDraft("");
    setDeleteModalOpen(true);
  };

  const closeDeleteDatabaseModal = () => {
    setDeleteModalOpen(false);
    setDeletePhraseDraft("");
  };

  const refreshSnapshotAfterDatabaseDelete = useCallback(() => {
    if (!currentWorkspaceId) return;
    window.setTimeout(() => refreshWorkspaceSnapshot(currentWorkspaceId), 0);
  }, [currentWorkspaceId]);

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
    refreshSnapshotAfterDatabaseDelete();
    closeDeleteDatabaseModal();
  };

  const restoreLatestDatabaseHistory = useCallback(() => {
    if (!hasDatabaseId) return;
    useDatabaseStore.getState().restoreDatabaseFromLatestHistory(databaseId);
  }, [databaseId, hasDatabaseId]);

  const restoreDatabaseHistoryEvent = useCallback(
    (eventId: string) => {
      if (!hasDatabaseId) return;
      useDatabaseStore.getState().restoreDatabaseFromHistoryEvent(databaseId, eventId);
    },
    [databaseId, hasDatabaseId],
  );

  const deleteDatabaseFromHistoryDialog = useCallback(() => {
    if (!hasDatabaseId || isProtectedDatabase) return;
    deleteDatabaseFromStore(databaseId);
    if (layout === "fullPage" && activePageId) {
      usePageStore.getState().deletePage(activePageId);
    } else {
      scheduleEditorMutation(() => deleteNode());
    }
    refreshSnapshotAfterDatabaseDelete();
  }, [
    activePageId,
    databaseId,
    deleteDatabaseFromStore,
    deleteNode,
    hasDatabaseId,
    isProtectedDatabase,
    layout,
    refreshSnapshotAfterDatabaseDelete,
  ]);

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
      scheduleEditorMutation(() => {
        updateAttributes({ panelState: JSON.stringify(next) });
      });
    },
    [databaseId, updateAttributes],
  );

  const setView = useCallback(
    (v: ViewKind) => {
      scheduleEditorMutation(() => {
        updateAttributes({ view: v });
      });
    },
    [updateAttributes],
  );

  const updateInlineBindingAttributes = useCallback(
    (attrs: Record<string, unknown>) => {
      scheduleEditorMutation(() => {
        if (layout === "inline") {
          try {
            const pos = typeof getPos === "function" ? getPos() : getPos;
            if (typeof pos === "number" && Number.isFinite(pos)) {
              const nodeAtPos = editor.state.doc.nodeAt(pos);
              if (nodeAtPos?.type.name === "databaseBlock") {
                editor.view.dispatch(
                  editor.state.tr
                    .setNodeMarkup(
                      pos,
                      undefined,
                      { ...nodeAtPos.attrs, ...attrs },
                      nodeAtPos.marks,
                    )
                    .setMeta("addToHistory", false),
                );
                return;
              }
            }
          } catch {
            // 위치 조회 실패 시 기존 경로로 폴백한다.
          }
        }
        updateAttributes(attrs);
      });
    },
    [editor, getPos, layout, updateAttributes],
  );

  const databasesList = useDatabaseStore(listDatabases);

  const linkPickerFiltered = useMemo(() => {
    const q = linkPickerQuery.trim().toLowerCase();
    if (!q) return databasesList;
    return databasesList.filter((d) =>
      d.meta.title.toLowerCase().includes(q),
    );
  }, [databasesList, linkPickerQuery]);
  const linkPickerCandidates = useMemo(
    () => linkPickerFiltered.filter((d) => d.id !== databaseId),
    [databaseId, linkPickerFiltered],
  );

  useEffect(() => {
    if (inlineBindingStep !== "link") return;
    setLinkPickerHighlight((prev) => {
      const n = linkPickerCandidates.length;
      if (n === 0) return -1;
      if (prev < 0) return 0;
      return Math.min(prev, n - 1);
    });
  }, [inlineBindingStep, linkPickerCandidates]);

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
      updateInlineBindingAttributes(
        layout === "fullPage"
          ? { databaseId: id }
          : { databaseId: id, readOnlyTitle: true },
      );
      if (layout === "fullPage" && activePageId && linked) {
        renamePage(activePageId, linked.meta.title);
      }
      setLinkOpen(false);
      setLinkPickerQuery("");
      setLinkPickerHighlight(0);
    },
    [layout, activePageId, updateInlineBindingAttributes, renamePage],
  );

  const createNewDatabaseAndBind = useCallback(() => {
    const id = useDatabaseStore.getState().createDatabase();
    const linked = useDatabaseStore.getState().databases[id];
    updateInlineBindingAttributes({ databaseId: id, readOnlyTitle: false });
    if (layout === "fullPage" && activePageId && linked) {
      renamePage(activePageId, linked.meta.title);
    }
    setLinkOpen(false);
    setLinkPickerQuery("");
    setLinkPickerHighlight(0);
  }, [layout, activePageId, updateInlineBindingAttributes, renamePage]);

  const onLinkPickerKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.nativeEvent.isComposing || e.key === "Process") return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setLinkPickerHighlight((h) => {
          const n = linkPickerCandidates.length;
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
          const n = linkPickerCandidates.length;
          if (n === 0) return -1;
          if (h <= 0) return 0;
          return h - 1;
        });
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const row = linkPickerCandidates[linkPickerHighlight];
        if (row) bindToExistingDatabase(row.id);
      }
    },
    [linkPickerCandidates, linkPickerHighlight, bindToExistingDatabase],
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
      ? "my-4 max-w-full"
      : "my-4";

  // 강제 클리핑은 100개 이상에서만 동작.
  // - inline / fullPage 모두 기본 limit = 100.
  // - DB 의 행 수가 100 미만이면 limit 을 적용하지 않고 전체 노출 (시각적 마스킹 어색함 제거).
  // - 사용자가 표시 설정 팝업에서 10/30/50/100 으로 명시 지정한 경우에만 그 값을 그대로 적용.
  // - extraRows 는 컴포넌트 state 이므로 페이지 재진입 시 자동으로 초기화됨.
  const defaultLimit = 100;
  const explicitLimit = panelState.itemLimit ?? null;
  const totalRowsForLimit = bundle?.rowPageOrder.length ?? 0;
  const visibleRowLimit = (() => {
    if (explicitLimit != null) return explicitLimit + extraRows;
    if (totalRowsForLimit < defaultLimit) return undefined; // 100 미만 → 클리핑 없음
    return defaultLimit + extraRows;
  })();

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
    <NodeViewWrapper className="qn-database-block not-prose">
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
                onTitleCommit={commitDbTitle}
                inlineTitleLocked={inlineTitleLocked}
                dbHomePageId={null}
                onOpenDbHomePage={openDbHomePage}
                onOpenDbHistory={() => setDbHistoryDialogOpen(true)}
                onOpenLink={() => {
                  setLinkPickerQuery("");
                  setLinkPickerHighlight(0);
                  setLinkOpen(true);
                }}
                inlineControlsCollapsed={inlineControlsCollapsed}
                onToggleInlineControls={() => {
                  if (!databaseId) return;
                  setInlineControlsCollapsed(
                    {
                      workspaceId: currentWorkspaceId,
                      memberId: currentMemberId,
                      databaseId,
                    },
                    !inlineControlsCollapsed,
                  );
                }}
                onTitleDragStart={onInlineTitleDragStart}
                onTitleDragEnd={onInlineTitleDragEnd}
              />
            ) : (
              <DatabaseBlockFullPageHeader
                onOpenDbHistory={() => setDbHistoryDialogOpen(true)}
                onOpenDeleteModal={openDeleteDatabaseModal}
                deleteDisabled={isProtectedDatabase}
              />
            )}

            {layout !== "inline" || !inlineControlsCollapsed ? (
              <DatabaseToolbarControls
                databaseId={databaseId}
                viewKind={view}
                view={view}
                onViewChange={setView}
                panelState={panelState}
                setPanelState={setPanelState}
                layout={layout}
              />
            ) : null}

            <DatabaseBlockDataArea bundleGone={bundleGone && !isProtectedDatabase}>
              <Suspense fallback={null}>
                {activeViewComponent}
              </Suspense>
            </DatabaseBlockDataArea>

            {/* 더보기 버튼 — visibleRowLimit 이 적용되어 일부가 잘릴 때만 노출.
                클릭 시 10개씩 추가 (잔여 < 10 이면 그만큼만), 추가된 분량만큼 자동 스크롤로 보여줌. */}
            {bundle && visibleRowLimit != null && (() => {
              const limit = visibleRowLimit;
              const totalRows = bundle.rowPageOrder.length;
              if (totalRows <= limit) return null;
              const remaining = totalRows - limit;
              const step = Math.min(10, remaining);
              return (
                <button
                  type="button"
                  onClick={(e) => {
                    setExtraRows((prev) => prev + step);
                    // 추가된 항목 영역 만큼 자동 스크롤 — 사용자가 새로 노출된 항목을 인지하도록.
                    // 버튼 위쪽 (= 새 항목들이 들어가는 위치) 으로 step * 행 추정 높이만큼 스크롤.
                    const btn = e.currentTarget;
                    const ROUGH_ROW_PX = 34;
                    const targetScroll = btn.getBoundingClientRect().bottom;
                    const scrollAmount = step * ROUGH_ROW_PX;
                    // 가장 가까운 스크롤 컨테이너 찾기
                    let host: HTMLElement | null = btn.parentElement;
                    while (host) {
                      const style = window.getComputedStyle(host);
                      const oy = style.overflowY;
                      if ((oy === "auto" || oy === "scroll") && host.scrollHeight > host.clientHeight) break;
                      host = host.parentElement;
                    }
                    requestAnimationFrame(() => {
                      if (host) host.scrollBy({ top: scrollAmount, behavior: "smooth" });
                      else window.scrollBy({ top: scrollAmount, behavior: "smooth" });
                      // 디버그: 컨테이너가 잡혔다는 사실만 확인용 (silent)
                      void targetScroll;
                    });
                  }}
                  className="mt-1 ml-auto block rounded-md border-transparent bg-transparent px-2 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  + {step}개 더보기
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
      <DatabaseBlockHistoryDialog
        open={dbHistoryDialogOpen && hasDatabaseId}
        databaseId={databaseId}
        layout={layout}
        isInsidePeek={isInsidePeek}
        isProtectedDatabase={isProtectedDatabase}
        onClose={() => setDbHistoryDialogOpen(false)}
        onRestoreLatest={restoreLatestDatabaseHistory}
        onRestoreHistoryEvent={restoreDatabaseHistoryEvent}
        onDeletePermanently={deleteDatabaseFromHistoryDialog}
      />
      <DatabaseBlockLinkExistingDialog
        open={linkOpen}
        isInsidePeek={isInsidePeek}
        query={linkPickerQuery}
        highlightIndex={linkPickerHighlight}
        listBaseId={linkPickerListBaseId}
        candidates={linkPickerCandidates}
        onQueryChange={setLinkPickerQuery}
        onHighlightChange={setLinkPickerHighlight}
        onKeyDown={onLinkPickerKeyDown}
        onSelect={bindToExistingDatabase}
        onClose={() => setLinkOpen(false)}
      />
    </NodeViewWrapper>
  );
}
