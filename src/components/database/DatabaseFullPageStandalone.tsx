import { lazy, Suspense, useCallback, useMemo, useRef } from "react";
import type { JSONContent } from "@tiptap/react";
import type { DatabasePanelState, ViewKind } from "../../types/database";
import { parseDatabasePanelStateJson } from "../../lib/schemas/panelStateSchema";
import { usePageStore } from "../../store/pageStore";
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
  pageId: string;
  databaseId: string;
  view: ViewKind;
  panelStateRaw: string;
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
  view,
  panelStateRaw,
}: Props) {
  const updateDoc = usePageStore((s) => s.updateDoc);
  const panelState = useMemo(
    () => parseDatabasePanelStateJson(panelStateRaw),
    [panelStateRaw],
  );
  const panelStateRef = useRef<DatabasePanelState>(panelState);
  panelStateRef.current = panelState;

  const updateBlockAttrs = useCallback(
    (attrs: Record<string, unknown>) => {
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
      updateBlockAttrs({ panelState: JSON.stringify(next) });
    },
    [updateBlockAttrs],
  );

  const setView = useCallback(
    (nextView: ViewKind) => {
      updateBlockAttrs({ view: nextView });
    },
    [updateBlockAttrs],
  );

  const activeView = useMemo(() => {
    switch (view) {
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
  }, [databaseId, panelState, setPanelState, view]);

  return (
    <div className="qn-database-block">
      <DatabaseToolbarControls
        databaseId={databaseId}
        viewKind={view}
        view={view}
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
