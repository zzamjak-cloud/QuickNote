import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/react";
import type { DatabasePanelState, ViewKind } from "../../types/database";
import { emptyPanelState } from "../../types/database";
import { parseDatabasePanelStateJson } from "../../lib/schemas/panelStateSchema";

/** 필터 프리셋 탭이 하나라도 있는지. */
function hasFilterPresets(ps: DatabasePanelState | null | undefined): boolean {
  return (ps?.filterPresets?.length ?? 0) > 0;
}
import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { useDatabaseViewPrefsStore } from "../../store/databaseViewPrefsStore";
import { DatabaseToolbarControls } from "./DatabaseToolbarControls";
import { DatabaseBlockDataArea } from "./DatabaseBlockDataArea";

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
  const databasePanelState = useDatabaseStore((s) => s.databases[databaseId]?.panelState);
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
  const panelState = useMemo(
    () => {
      // 원본 DB 는 bundle.panelState 를 source of truth 로 사용한다.
      // bundle 에 탭이 있으면 우선, 없으면 블록 attrs(시드 전 폴백) → directPanelState 순.
      if (hasFilterPresets(databasePanelState)) return databasePanelState!;
      const blockPanelState = pageId
        ? parseDatabasePanelStateJson(panelStateRaw ?? "{}")
        : null;
      if (blockPanelState && hasFilterPresets(blockPanelState)) return blockPanelState;
      return pageId ? (blockPanelState ?? emptyPanelState()) : directPanelState;
    },
    [databasePanelState, directPanelState, pageId, panelStateRaw],
  );
  const activeViewKind = pageId ? view : directView;
  const panelStateRef = useRef<DatabasePanelState>(panelState);
  panelStateRef.current = panelState;

  useEffect(() => {
    if (pageId) return;
    setDirectPanelState(databasePanelState ?? getPanelState(databaseId, panelStateRaw));
    setDirectView(getStoredView(databaseId, view));
  }, [databaseId, databasePanelState, getPanelState, getStoredView, pageId, panelStateRaw, view]);

  // 시드/복구: 과거에 블록 attrs 에만 저장되던 필터 프리셋 탭을, bundle.panelState 가
  // 비어 있을 때 1회 옮겨 DB 귀속 상태로 만들고 서버 동기화를 시작한다.
  // (Editor 풀페이지 경로 회귀로 bundle 이 비어 탭이 사라진 케이스의 복구 경로)
  useEffect(() => {
    if (!pageId) return;
    const blockPanelState = parseDatabasePanelStateJson(panelStateRaw ?? "{}");
    if (!hasFilterPresets(blockPanelState)) return;
    const bundlePanelState = useDatabaseStore.getState().databases[databaseId]?.panelState;
    if (hasFilterPresets(bundlePanelState)) return;
    patchDatabasePanelState(databaseId, blockPanelState);
  }, [databaseId, pageId, panelStateRaw, patchDatabasePanelState]);

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
      setDirectPanelState(next);
      // 원본 DB 의 필터 프리셋(탭)은 DB 에 귀속 + 서버 동기화되어야 하므로 pageId 유무와
      // 무관하게 항상 bundle.panelState 를 갱신한다. (이전엔 pageId 경로에서 블록 attrs 만
      // 갱신 → bundle 이 비어 → 다음 업서트가 서버 탭을 비우는 회귀)
      patchDatabasePanelState(databaseId, patch);
      if (pageId) {
        updateBlockAttrs({ panelState: JSON.stringify(next) });
      } else {
        patchPanelState(databaseId, patch, panelStateRaw);
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

  const activeView = useMemo(() => {
    switch (activeViewKind) {
      case "table":
        return (
          <DatabaseTableView
            databaseId={databaseId}
            panelState={panelState}
            setPanelState={setPanelState}
            layout="fullPage"
          />
        );
      case "list":
        return (
          <DatabaseListView
            databaseId={databaseId}
            panelState={panelState}
            setPanelState={setPanelState}
          />
        );
      case "kanban":
        return (
          <DatabaseKanbanView
            databaseId={databaseId}
            panelState={panelState}
            setPanelState={setPanelState}
          />
        );
      case "gallery":
        return (
          <DatabaseGalleryView
            databaseId={databaseId}
            panelState={panelState}
            setPanelState={setPanelState}
          />
        );
      case "timeline":
        return (
          <DatabaseTimelineView
            databaseId={databaseId}
            panelState={panelState}
            setPanelState={setPanelState}
          />
        );
      default:
        return null;
    }
  }, [activeViewKind, databaseId, panelState, setPanelState]);

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
    </div>
  );
}
