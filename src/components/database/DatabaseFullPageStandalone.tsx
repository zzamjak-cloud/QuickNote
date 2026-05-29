import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/react";
import type { DatabasePanelState, ViewKind } from "../../types/database";
import { parseDatabasePanelStateJson } from "../../lib/schemas/panelStateSchema";
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
    () => (pageId ? parseDatabasePanelStateJson(panelStateRaw ?? "{}") : directPanelState),
    [directPanelState, pageId, panelStateRaw],
  );
  const activeViewKind = pageId ? view : directView;
  const panelStateRef = useRef<DatabasePanelState>(panelState);
  panelStateRef.current = panelState;

  useEffect(() => {
    if (pageId) return;
    setDirectPanelState(databasePanelState ?? getPanelState(databaseId, panelStateRaw));
    setDirectView(getStoredView(databaseId, view));
  }, [databaseId, databasePanelState, getPanelState, getStoredView, pageId, panelStateRaw, view]);

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
        updateBlockAttrs({ panelState: JSON.stringify(next) });
      } else {
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
