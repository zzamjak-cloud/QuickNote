import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Database,
  List as ListIcon,
  Kanban,
  GalleryHorizontal,
  GanttChartSquare,
  Table2,
  Link2,
  ArrowLeft,
  Trash2,
} from "lucide-react";
import { listDatabases, useDatabaseStore } from "../../store/databaseStore";
import { usePageStore } from "../../store/pageStore";
import type {
  DatabaseLayout,
  DatabasePanelState,
  ViewKind,
} from "../../types/database";
import { emptyPanelState } from "../../types/database";
import { DatabaseTableView } from "./views/DatabaseTableView";
import { DatabaseKanbanView } from "./views/DatabaseKanbanView";
import { DatabaseGalleryView } from "./views/DatabaseGalleryView";
import { DatabaseListView } from "./views/DatabaseListView";
import { DatabaseTimelineView } from "./views/DatabaseTimelineView";
import { DatabaseToolbarControls } from "./DatabaseToolbarControls";
function parsePanelState(raw: string): DatabasePanelState {
  try {
    const o = JSON.parse(raw) as Partial<DatabasePanelState>;
    return { ...emptyPanelState(), ...o };
  } catch {
    return emptyPanelState();
  }
}

/** ProseMirror 업데이트를 렌더링 밖으로 미뤄 React 19 flushSync 경고 방지 */
function scheduleAttrsUpdate(
  fn: () => void,
): void {
  queueMicrotask(fn);
}

const VIEW_ICONS: Record<ViewKind, typeof Table2> = {
  table: Table2,
  kanban: Kanban,
  gallery: GalleryHorizontal,
  list: ListIcon,
  timeline: GanttChartSquare,
};

export function DatabaseBlockView(props: NodeViewProps) {
  const { node, updateAttributes, deleteNode } = props;
  const databaseId = String(node.attrs.databaseId ?? "");
  const layout = (node.attrs.layout ?? "inline") as DatabaseLayout;
  const view = (node.attrs.view ?? "table") as ViewKind;
  const panelState = parsePanelState(String(node.attrs.panelState ?? "{}"));
  const panelStateRef = useRef(panelState);
  panelStateRef.current = panelState;

  const bundle = useDatabaseStore((s) => s.databases[databaseId]);
  const setDatabaseTitle = useDatabaseStore((s) => s.setDatabaseTitle);
  const deleteDatabaseFromStore = useDatabaseStore((s) => s.deleteDatabase);
  const renamePage = usePageStore((s) => s.renamePage);
  const activePageId = usePageStore((s) => s.activePageId);

  const displayDbTitle = bundle?.meta.title ?? "데이터베이스";
  const [titleDraft, setTitleDraft] = useState(displayDbTitle);
  useEffect(() => {
    setTitleDraft(displayDbTitle);
  }, [displayDbTitle, databaseId]);

  const commitDbTitle = () => {
    const t = titleDraft.trim() || "제목 없음";
    setDatabaseTitle(databaseId, t);
    if (layout === "fullPage" && activePageId) {
      renamePage(activePageId, t);
    }
  };

  const handleDeleteDatabasePermanently = () => {
    const name = bundle?.meta.title ?? (titleDraft.trim() || "데이터베이스");
    if (
      !window.confirm(
        `「${name}」데이터베이스를 저장소에서 영구 삭제할까요?\n\n· 모든 속성과 행이 삭제됩니다.\n· 같은 DB를 다른 페이지에 연결해 둔 블록은 더 이상 데이터를 불러오지 못합니다.`,
      )
    ) {
      return;
    }
    deleteDatabaseFromStore(databaseId);
    scheduleAttrsUpdate(() => {
      deleteNode();
    });
  };

  const [linkOpen, setLinkOpen] = useState(false);

  const setPanelState = useCallback(
    (patch: Partial<DatabasePanelState>) => {
      scheduleAttrsUpdate(() => {
        const next = { ...panelStateRef.current, ...patch };
        panelStateRef.current = next;
        updateAttributes({ panelState: JSON.stringify(next) });
      });
    },
    [updateAttributes],
  );

  const setView = useCallback(
    (v: ViewKind) => {
      scheduleAttrsUpdate(() => {
        updateAttributes({ view: v });
      });
    },
    [updateAttributes],
  );

  const databasesList = useDatabaseStore(listDatabases);

  const shellClass =
    layout === "fullPage"
      ? "my-4 w-[calc(100%+6rem)] max-w-none -mx-12 rounded-xl border border-zinc-200 bg-zinc-50/80 dark:border-zinc-700 dark:bg-zinc-900/40"
      : "my-4 rounded-xl border border-zinc-200 bg-zinc-50/80 dark:border-zinc-700 dark:bg-zinc-900/40";

  const missing = !bundle;

  const activeViewComponent = useMemo(() => {
    if (missing) return null;
    switch (view) {
      case "table":
        return (
          <DatabaseTableView
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
      case "list":
        return (
          <DatabaseListView
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
  }, [databaseId, missing, panelState, setPanelState, view]);

  return (
    <NodeViewWrapper className="qn-database-block">
      <div className={shellClass}>
        <div className="flex flex-wrap items-center gap-1 border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-700">
          <Database size={16} className="text-zinc-500" />
          <input
            type="text"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitDbTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="데이터베이스 이름"
            title="이름 변경 (전체 페이지면 페이지 제목과 함께 바뀝니다)"
            className="min-w-[100px] flex-1 rounded border border-transparent bg-transparent px-1 text-xs font-medium text-zinc-700 outline-none focus:border-zinc-300 dark:text-zinc-300 dark:focus:border-zinc-600"
          />
          <div className="ml-auto flex flex-wrap items-center gap-0.5">
            {(Object.keys(VIEW_ICONS) as ViewKind[]).map((vk) => {
              const Icon = VIEW_ICONS[vk];
              const on = view === vk;
              return (
                <button
                  key={vk}
                  type="button"
                  title={vk}
                  onClick={() => setView(vk)}
                  className={[
                    "rounded p-1",
                    on
                      ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100"
                      : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800",
                  ].join(" ")}
                >
                  <Icon size={15} />
                </button>
              );
            })}
            <button
              type="button"
              title="다른 DB 연결"
              onClick={() => setLinkOpen((v) => !v)}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <Link2 size={15} />
            </button>
            <button
              type="button"
              title="데이터베이스 영구 삭제"
              onClick={handleDeleteDatabasePermanently}
              className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>

        <DatabaseToolbarControls
          databaseId={databaseId}
          panelState={panelState}
          setPanelState={setPanelState}
        />

        {linkOpen && (
          <div className="border-b border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700">
            <div className="mb-1 font-medium text-zinc-700 dark:text-zinc-300">
              기존 데이터베이스에 연결
            </div>
            <select
              className="w-full max-w-xs rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-600 dark:bg-zinc-900"
              value=""
              onChange={(e) => {
                const id = e.target.value;
                if (id) {
                  const linked = useDatabaseStore.getState().databases[id];
                  scheduleAttrsUpdate(() => {
                    updateAttributes({ databaseId: id });
                  });
                  if (layout === "fullPage" && activePageId && linked) {
                    renamePage(activePageId, linked.meta.title);
                  }
                  setLinkOpen(false);
                }
              }}
            >
              <option value="">선택…</option>
              {databasesList
                .filter((d) => d.id !== databaseId)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.meta.title}
                  </option>
                ))}
            </select>
          </div>
        )}

        <div className="overflow-x-auto p-2">
          {missing ? (
            <div className="flex items-center gap-2 px-2 py-8 text-sm text-amber-700 dark:text-amber-400">
              <ArrowLeft size={16} />
              데이터를 찾을 수 없습니다. 연결을 다른 DB로 바꾸거나 블록을 삭제하세요.
            </div>
          ) : (
            activeViewComponent
          )}
        </div>
      </div>
    </NodeViewWrapper>
  );
}
