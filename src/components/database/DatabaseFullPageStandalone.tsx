import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/react";
import type { DatabasePanelState, ViewKind } from "../../types/database";
import { parseDatabasePanelStateJson } from "../../lib/schemas/panelStateSchema";
import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { useDatabaseViewPrefsStore } from "../../store/databaseViewPrefsStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import {
  ensureDatabaseRowsLoaded,
  loadMoreDatabaseRows,
  resolveDatabaseRowRemoteKey,
} from "../../lib/sync/externalProtectedDatabaseLoad";
import { DatabaseToolbarControls } from "./DatabaseToolbarControls";
import { DatabaseBlockDataArea } from "./DatabaseBlockDataArea";
import { useDatabaseRowRemoteStore } from "../../store/databaseRowRemoteStore";
import {
  resolveDatabaseInitialRowLimit,
  resolveDatabaseVisibleRowLimit,
} from "./databaseRowLimit";

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

type Props = {
  pageId?: string;
  databaseId: string;
  view?: ViewKind;
  panelStateRaw?: string;
};

function patchFullPageDatabaseBlock(
  doc: JSONContent,
  attrs: Record<string, unknown>,
): JSONContent | null {
  const first = doc.content?.[0];
  if (first?.type !== "databaseBlock") return null;
  return {
    type: "doc",
    content: [
      {
        ...first,
        attrs: {
          ...(first.attrs ?? {}),
          ...attrs,
          layout: "fullPage",
        },
      },
    ],
  };
}

export function DatabaseFullPageStandalone({
  pageId,
  databaseId,
  view = "table",
  panelStateRaw,
}: Props) {
  const updateDoc = usePageStore((s) => s.updateDoc);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const databasePanelState = useDatabaseStore((s) => s.databases[databaseId]?.panelState);
  const bundle = useDatabaseStore((s) => s.databases[databaseId]);
  const rowPageOrderKey = useDatabaseStore(
    (s) => s.databases[databaseId]?.rowPageOrder.join("|") ?? "",
  );
  const remoteRowKey = resolveDatabaseRowRemoteKey(databaseId, currentWorkspaceId);
  const remoteRowNextToken = useDatabaseRowRemoteStore(
    (s) => (remoteRowKey ? s.nextTokenByDatabaseId[remoteRowKey] : null) ?? null,
  );
  const remoteRowsLoading = useDatabaseRowRemoteStore(
    (s) => (remoteRowKey ? s.loadingByDatabaseId[remoteRowKey] : false) ?? false,
  );
  const patchDatabasePanelState = useDatabaseStore((s) => s.patchDatabasePanelState);
  const getPanelState = useDatabaseViewPrefsStore((s) => s.getPanelState);
  const patchPanelState = useDatabaseViewPrefsStore((s) => s.patchPanelState);
  const getStoredView = useDatabaseViewPrefsStore((s) => s.getView);
  const setStoredView = useDatabaseViewPrefsStore((s) => s.setView);
  const [directPanelState, setDirectPanelState] = useState<DatabasePanelState>(() =>
    databasePanelState ?? getPanelState(databaseId, panelStateRaw),
  );
  const [directView, setDirectView] = useState<ViewKind>(() =>
    getStoredView(databaseId, view),
  );
  // pageId 가 있으면(Editor 풀페이지) panelState 는 페이지 doc(블록 attrs)=panelStateRaw 가
  // source of truth 다. 인라인 DB 와 동일하게 Page 모델 동기화에 무임승차하여 클라이언트 간
  // 동기화가 보장된다. pageId 가 없으면(DirectPage) 페이지 doc 가 없으므로 bundle 을 사용.
  const panelState = useMemo(
    () => (pageId ? parseDatabasePanelStateJson(panelStateRaw ?? "{}") : directPanelState),
    [directPanelState, pageId, panelStateRaw],
  );
  const activeViewKind = pageId ? view : directView;
  const [extraRows, setExtraRows] = useState(0);
  const panelStateRef = useRef<DatabasePanelState>(panelState);
  panelStateRef.current = panelState;

  useEffect(() => {
    if (pageId) return;
    setDirectPanelState(databasePanelState ?? getPanelState(databaseId, panelStateRaw));
    setDirectView(getStoredView(databaseId, view));
  }, [databaseId, databasePanelState, getPanelState, getStoredView, pageId, panelStateRaw, view]);

  useEffect(() => {
    if (!currentWorkspaceId) return;
    let cancelled = false;
    void ensureDatabaseRowsLoaded({
      databaseId,
      currentWorkspaceId,
      cancelled: () => cancelled,
      rowLimit: resolveDatabaseInitialRowLimit("fullPage", panelState.itemLimit),
      source: pageId ? "database-fullpage-editor" : "database-fullpage-direct",
    });
    return () => {
      cancelled = true;
    };
  }, [currentWorkspaceId, databaseId, pageId, panelState.itemLimit, rowPageOrderKey]);

  const updateBlockAttrs = useCallback(
    (attrs: Record<string, unknown>) => {
      if (!pageId) return;
      const current = usePageStore.getState().pages[pageId]?.doc;
      if (!current) return;
      const next = patchFullPageDatabaseBlock(current, attrs);
      if (!next) return;
      updateDoc(pageId, next, { skipHistory: true });
    },
    [pageId, updateDoc],
  );

  const setPanelState = useCallback(
    (patch: Partial<DatabasePanelState>) => {
      const next = { ...panelStateRef.current, ...patch };
      panelStateRef.current = next;
      if (pageId) {
        // Editor 풀페이지: 페이지 doc(블록 attrs)에 기록 → Page 모델로 동기화(인라인과 동일).
        updateBlockAttrs({ panelState: JSON.stringify(next) });
      } else {
        // DirectPage: 페이지 doc 가 없으므로 bundle.panelState 에 기록 → Database 모델로 동기화.
        setDirectPanelState(next);
        patchPanelState(databaseId, patch, panelStateRaw);
        patchDatabasePanelState(databaseId, patch);
      }
    },
    [databaseId, pageId, panelStateRaw, patchDatabasePanelState, patchPanelState, updateBlockAttrs],
  );

  const setView = useCallback(
    (nextView: ViewKind) => {
      if (pageId) {
        updateBlockAttrs({ view: nextView });
      } else {
        setDirectView(nextView);
        setStoredView(databaseId, nextView);
      }
    },
    [databaseId, pageId, setStoredView, updateBlockAttrs],
  );

  const totalRowsForLimit = bundle?.rowPageOrder.length ?? 0;
  const remoteRowsHasMore = Boolean(currentWorkspaceId) && Boolean(remoteRowNextToken);
  const visibleRowLimit = resolveDatabaseVisibleRowLimit({
    layout: "fullPage",
    itemLimit: panelState.itemLimit,
    totalRows: totalRowsForLimit,
    extraRows,
  });

  const activeView = useMemo(() => {
    switch (activeViewKind) {
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
  }, [activeViewKind, databaseId, panelState, setPanelState, visibleRowLimit]);

  return (
    <div className="qn-database-block">
      <DatabaseToolbarControls
        databaseId={databaseId}
        viewKind={activeViewKind}
        view={activeViewKind}
        onViewChange={setView}
        panelState={panelState}
        setPanelState={setPanelState}
        layout="fullPage"
      />
      <DatabaseBlockDataArea bundleGone={false}>
        <Suspense fallback={null}>{activeView}</Suspense>
      </DatabaseBlockDataArea>
      {bundle && (visibleRowLimit != null || remoteRowsHasMore) && (() => {
        const limit = visibleRowLimit ?? totalRowsForLimit;
        const localRemaining = Math.max(0, bundle.rowPageOrder.length - limit);
        if (localRemaining <= 0 && !remoteRowsHasMore) return null;
        const remoteStep = resolveDatabaseInitialRowLimit("fullPage", panelState.itemLimit);
        const localStep = Math.min(remoteStep, localRemaining);
        const step = localStep > 0 ? localStep : remoteStep;
        return (
          <button
            type="button"
            disabled={remoteRowsLoading}
            onClick={async () => {
              if (localStep > 0) {
                setExtraRows((prev) => prev + localStep);
                return;
              }
              if (!remoteRowsHasMore) return;
              const loaded = await loadMoreDatabaseRows({
                databaseId,
                currentWorkspaceId,
                rowLimit: remoteStep,
                source: pageId ? "database-fullpage-editor-more" : "database-fullpage-direct-more",
              });
              if (loaded) setExtraRows((prev) => prev + remoteStep);
            }}
            className="mt-2 ml-auto block rounded-md border-transparent bg-transparent px-2 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:cursor-wait disabled:opacity-60 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {remoteRowsLoading ? "불러오는 중" : `+ ${step}개 더보기`}
          </button>
        );
      })()}
    </div>
  );
}
