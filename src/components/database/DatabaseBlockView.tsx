import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";
import {
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
import { koreanIncludes } from "../../lib/koreanSearch";
import { listDatabases, useDatabaseStore } from "../../store/databaseStore";
import { usePageStore } from "../../store/pageStore";
import { useSettingsStore } from "../../store/settingsStore";
import type {
  DatabaseLayout,
  DatabasePanelState,
  ViewKind,
} from "../../types/database";
import { parseDatabasePanelStateJson } from "../../lib/schemas/panelStateSchema";
import { DATABASE_VIEW_REGISTRY } from "./databaseViewRegistry";
import { DatabaseToolbarControls } from "./DatabaseToolbarControls";
import { scheduleEditorMutation } from "../../lib/pm/scheduleEditorMutation";
import { normalizeConfirmPhrase } from "../../lib/text/normalizeConfirmPhrase";
import { DatabaseBlockBinding } from "./DatabaseBlockBinding";
import { DatabaseBlockDataArea } from "./DatabaseBlockDataArea";
import { DatabaseBlockFullPageHeader } from "./DatabaseBlockFullPageHeader";
import { DatabaseBlockInlineHeader } from "./DatabaseBlockInlineHeader";
import { isProtectedDatabaseId } from "../../lib/scheduler/database";
import { DatabaseDeleteConfirmDialog } from "./DatabaseDeleteConfirmDialog";
import { useWorkspaceStore } from "../../store/workspaceStore";
import {
  ensureDatabaseRowsLoaded,
  loadMoreDatabaseRows,
  resolveDatabaseRowRemoteKey,
  resolveExternalProtectedDatabaseId,
} from "../../lib/sync/externalProtectedDatabaseLoad";
import { refreshWorkspaceSnapshot } from "../../lib/sync/workspaceSwitch";
import { DatabaseBlockHistoryDialog } from "./DatabaseBlockHistoryDialog";
import { DatabaseBlockLinkExistingDialog } from "./DatabaseBlockLinkExistingDialog";
import { useMemberStore } from "../../store/memberStore";
import { useUiStore } from "../../store/uiStore";
import {
  makeInlineControlsPrefsKey,
  useDatabaseInlineUiPrefsStore,
} from "../../store/databaseInlineUiPrefsStore";
import { useDatabaseRowRemoteStore } from "../../store/databaseRowRemoteStore";
import { useDatabaseRowIndexStore } from "../../store/databaseRowIndexStore";
import {
  DEFAULT_DATABASE_VISIBLE_ROW_LIMIT,
  resolveDatabaseInitialRowLimit,
  resolveDatabaseVisibleRowLimit,
} from "./databaseRowLimit";
import { useDatabaseCollabSession } from "../../lib/collab/useDatabaseCollabSession";
import { useIsMobile } from "../../hooks/useViewport";
import { DatabaseCardListView } from "./views/DatabaseCardListView";
import {
  loadCrossWorkspaceDatabaseCandidates,
  rememberCrossWorkspaceDatabase,
  type CrossWorkspaceDatabaseCandidate,
} from "../../lib/crossWorkspaceSearch";

const DEFAULT_VISIBLE_ROW_LIMIT = DEFAULT_DATABASE_VISIBLE_ROW_LIMIT;

export function DatabaseBlockView(props: NodeViewProps) {
  const { editor, node, getPos, updateAttributes, deleteNode } = props;
  const isMobile = useIsMobile();
  const databaseId = String(node.attrs.databaseId ?? "");
  const viewDatabaseId = resolveExternalProtectedDatabaseId(databaseId) ?? databaseId;
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

  const bundle = useDatabaseStore((s) => s.databases[viewDatabaseId]);
  // 번들이 아직 없으면(타 워크스페이스 페이지를 피크/멘션으로 열어 인라인 DB 가 콜드 로드되는 경우)
  // 세션 현재 워크스페이스로 폴백하면 DB 를 엉뚱한 워크스페이스에서 찾아 영영 못 불러온다(연결 끊김).
  // 인라인 DB 의 실제 워크스페이스는 그것을 담은 호스트 페이지(피크 중이면 peek, 아니면 active)의
  // 워크스페이스이므로 이를 우선 폴백으로 사용해 올바른 워크스페이스에서 번들을 적재한다.
  const peekPageId = useUiStore((s) => s.peekPageId);
  const activePageId = usePageStore((s) => s.activePageId);
  const hostPageId = isInsidePeek ? peekPageId : activePageId;
  const hostPageWorkspaceId = usePageStore((s) =>
    hostPageId ? s.pages[hostPageId]?.workspaceId ?? null : null,
  );
  const databaseWorkspaceId =
    bundle?.meta.workspaceId ?? hostPageWorkspaceId ?? currentWorkspaceId;

  // DB 구조·셀 실시간 협업(Phase 4) — flag ON 인 DB 만 활성. materialize 시 store 에 투영, 첫 sync 시 행 셀 시드 폴백.
  useDatabaseCollabSession(
    viewDatabaseId,
    (structure) => useDatabaseStore.getState().applyCollabDbStructure(viewDatabaseId, structure),
    () => useDatabaseStore.getState().seedCollabRowsFromStore(viewDatabaseId),
  );

  const hasDatabaseId = databaseId.length > 0;
  const needsBinding = !hasDatabaseId;
  const bundleGone = hasDatabaseId && !bundle;
  const isProtectedDatabase = isProtectedDatabaseId(databaseId);
  const rowPageOrder = bundle?.rowPageOrder;
  const remoteRowKey = resolveDatabaseRowRemoteKey(databaseId, databaseWorkspaceId);
  const remoteRowNextToken = useDatabaseRowRemoteStore(
    (s) => (remoteRowKey ? s.nextTokenByDatabaseId[remoteRowKey] : null) ?? null,
  );
  const remoteRowsLoading = useDatabaseRowRemoteStore(
    (s) => (remoteRowKey ? s.loadingByDatabaseId[remoteRowKey] : false) ?? false,
  );
  const rowIndexRowCount = useDatabaseRowIndexStore(
    (s) => (remoteRowKey ? s.snapshotsByKey[remoteRowKey]?.rows.length ?? 0 : 0),
  );

  const setDatabaseTitle = useDatabaseStore((s) => s.setDatabaseTitle);
  const deleteDatabaseFromStore = useDatabaseStore((s) => s.deleteDatabase);
  const renamePage = usePageStore((s) => s.renamePage);
  const setActivePageNav = usePageStore((s) => s.setActivePage);
  const setCurrentTabDatabase = useSettingsStore((s) => s.setCurrentTabDatabase);

  const inlineTitleLocked = isProtectedDatabase;

  // 내비게이션 히스토리 (인라인→전체 DB 전환 시 뒤로가기 지원).
  const pushBack = useNavigationHistoryStore((s) => s.pushBack);

  const openDbHomePage = useCallback(
    (_pageId: string | null) => {
      if (activePageId) pushBack(activePageId);
      setActivePageNav(null);
      setCurrentTabDatabase(viewDatabaseId);
    },
    [activePageId, pushBack, setActivePageNav, setCurrentTabDatabase, viewDatabaseId],
  );

  // 더보기 — 추가로 표시할 행 수.
  const [extraRows, setExtraRows] = useState(0);

  const displayDbTitle = bundle?.meta.title ?? "데이터베이스";
  const deleteConfirmPhrase = useMemo(() => {
    const name = normalizeConfirmPhrase(displayDbTitle) || "데이터베이스";
    return `${name} 삭제`;
  }, [displayDbTitle]);

  const commitDbTitle = (draft: string) => {
    if (!hasDatabaseId) return false;
    const t = draft.trim() || "제목 없음";
    const ok = setDatabaseTitle(viewDatabaseId, t);
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
      databaseId: viewDatabaseId,
    });
  }, [currentWorkspaceId, currentMemberId, databaseId, viewDatabaseId]);

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

  useEffect(() => {
    if (!hasDatabaseId || !databaseWorkspaceId) return;
    let cancelled = false;
    void ensureDatabaseRowsLoaded({
      databaseId,
      currentWorkspaceId: databaseWorkspaceId,
      cancelled: () => cancelled,
      rowLimit: resolveDatabaseInitialRowLimit(layout, panelState.itemLimit),
      source: "database-block",
    });
    return () => {
      cancelled = true;
    };
  }, [databaseWorkspaceId, databaseId, hasDatabaseId, layout, panelState.itemLimit, rowPageOrder]);

  const executeDeleteDatabasePermanently = () => {
    if (!hasDatabaseId) return;
    if (isProtectedDatabase) return;
    if (normalizeConfirmPhrase(deletePhraseDraft) !== deleteConfirmPhrase) {
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

  const localDatabasesList = useDatabaseStore(listDatabases);
  const localDatabasesSignature = useMemo(
    () => localDatabasesList.map((db) => `${db.id}:${db.meta.updatedAt}`).join("|"),
    [localDatabasesList],
  );
  const [databaseCandidates, setDatabaseCandidates] = useState<CrossWorkspaceDatabaseCandidate[]>([]);

  useEffect(() => {
    let cancelled = false;
    void loadCrossWorkspaceDatabaseCandidates().then((rows) => {
      if (!cancelled) setDatabaseCandidates(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [localDatabasesSignature]);

  const databasesList = databaseCandidates.length > 0
    ? databaseCandidates.map((db) => ({ id: db.id, meta: db.meta }))
    : localDatabasesList;

  const linkPickerFiltered = useMemo(() => {
    const q = linkPickerQuery.trim().toLowerCase();
    if (!q) return databasesList;
    return databasesList.filter((d) =>
      koreanIncludes(d.meta.title.toLowerCase(), q),
    );
  }, [databasesList, linkPickerQuery]);
  const linkPickerCandidates = useMemo(
    () => linkPickerFiltered.filter((d) => d.id !== viewDatabaseId),
    [linkPickerFiltered, viewDatabaseId],
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
      const candidate = databaseCandidates.find((db) => db.id === id);
      if (candidate) rememberCrossWorkspaceDatabase(candidate);
      const linked = useDatabaseStore.getState().databases[id];
      const linkedTitle = linked?.meta.title ?? candidate?.meta.title ?? "";
      updateInlineBindingAttributes(
        layout === "fullPage"
          ? { databaseId: id }
          : { databaseId: id, readOnlyTitle: true },
      );
      if (layout === "fullPage" && activePageId && linkedTitle) {
        renamePage(activePageId, linkedTitle);
      }
      setLinkOpen(false);
      setLinkPickerQuery("");
      setLinkPickerHighlight(0);
    },
    [databaseCandidates, layout, activePageId, updateInlineBindingAttributes, renamePage],
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
      ? "my-4 max-w-full pb-28"
      : "my-4";

  // 강제 클리핑은 100개 이상에서만 동작.
  // - inline 은 itemLimit 를 따르고, fullPage 는 인라인 표시 개수와 독립적으로 기본 100을 사용한다.
  // - DB 의 행 수가 100 미만이면 limit 을 적용하지 않고 전체 노출 (시각적 마스킹 어색함 제거).
  // - 사용자가 표시 설정 팝업에서 10/30/50/100 으로 명시 지정한 경우에만 그 값을 그대로 적용.
  // - extraRows 는 컴포넌트 state 이므로 페이지 재진입 시 자동으로 초기화됨.
  const defaultLimit = DEFAULT_VISIBLE_ROW_LIMIT;
  const explicitLimit = layout === "inline" ? panelState.itemLimit ?? null : null;
  const totalRowsForLimit = Math.max(bundle?.rowPageOrder.length ?? 0, rowIndexRowCount);
  const remoteRowsHasMore =
    Boolean(currentWorkspaceId) &&
    Boolean(remoteRowNextToken);
  const visibleRowLimit = resolveDatabaseVisibleRowLimit({
    layout,
    itemLimit: panelState.itemLimit,
    totalRows: totalRowsForLimit,
    extraRows,
  });

  const activeViewComponent = useMemo(() => {
    if (!bundle) return null;
    // 모바일: 테이블 뷰는 가로 스크롤 대신 카드 리스트로 fallback(열람).
    if (isMobile && view === "table") {
      return (
        <DatabaseCardListView
          databaseId={viewDatabaseId}
          panelState={panelState}
          setPanelState={setPanelState}
          visibleRowLimit={visibleRowLimit}
        />
      );
    }
    const entry = DATABASE_VIEW_REGISTRY[view];
    if (!entry) return null;
    const ViewComponent = entry.component;
    return (
      <ViewComponent
        databaseId={viewDatabaseId}
        panelState={panelState}
        setPanelState={setPanelState}
        visibleRowLimit={visibleRowLimit}
      />
    );
  }, [bundle, isMobile, panelState, setPanelState, view, viewDatabaseId, visibleRowLimit]);

  return (
    <NodeViewWrapper className="qn-database-block not-prose" contentEditable={false}>
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
                      databaseId: viewDatabaseId,
                    },
                    !inlineControlsCollapsed,
                  );
                }}
                onTitleDragStart={onInlineTitleDragStart}
                onTitleDragEnd={onInlineTitleDragEnd}
                hideTitle={panelState.hideTitle}
                headerColor={panelState.headerColor}
              />
            ) : (
              <DatabaseBlockFullPageHeader
                displayDbTitle={displayDbTitle}
                onTitleCommit={commitDbTitle}
                titleLocked={isProtectedDatabase}
                onOpenDbHistory={() => setDbHistoryDialogOpen(true)}
                onOpenDeleteModal={openDeleteDatabaseModal}
                deleteDisabled={isProtectedDatabase}
              />
            )}

            {layout !== "inline" || !inlineControlsCollapsed ? (
              <DatabaseToolbarControls
                databaseId={viewDatabaseId}
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

            {/* 더보기 버튼 — 표시 설정의 항목 수만큼 추가 노출한다. */}
            {bundle && (visibleRowLimit != null || remoteRowsHasMore) && (() => {
              const limit = visibleRowLimit ?? totalRowsForLimit;
              const totalRows = totalRowsForLimit;
              const localRemaining = Math.max(0, totalRows - limit);
              if (localRemaining <= 0 && !remoteRowsHasMore) return null;
              const remaining = totalRows - limit;
              const remoteStep = explicitLimit ?? defaultLimit;
              const localStep = Math.min(remoteStep, Math.max(0, remaining));
              const step = localStep > 0 ? localStep : remoteStep;
              return (
                <button
                  type="button"
                  disabled={remoteRowsLoading}
                  onClick={async (e) => {
                    const btn = e.currentTarget;
                    if (localStep > 0) {
                      setExtraRows((prev) => prev + localStep);
                    } else if (remoteRowsHasMore) {
                      const loaded = await loadMoreDatabaseRows({
                        databaseId,
                        currentWorkspaceId: databaseWorkspaceId,
                        rowLimit: remoteStep,
                        source: "database-block-more",
                      });
                      if (loaded) setExtraRows((prev) => prev + remoteStep);
                    }
                    // 추가된 항목 영역 만큼 자동 스크롤 — 사용자가 새로 노출된 항목을 인지하도록.
                    // 버튼 위쪽 (= 새 항목들이 들어가는 위치) 으로 step * 행 추정 높이만큼 스크롤.
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
                  className="mt-1 ml-auto block rounded-md border-transparent bg-transparent px-2 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:cursor-wait disabled:opacity-60 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  {remoteRowsLoading ? "불러오는 중" : `+ ${step}개 더보기`}
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
        databaseId={viewDatabaseId}
        layout={layout}
        isInsidePeek={isInsidePeek}
        isProtectedDatabase={isProtectedDatabase}
        onClose={() => setDbHistoryDialogOpen(false)}
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
