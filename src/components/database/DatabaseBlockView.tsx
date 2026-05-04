import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
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
import { DatabaseToolbarControls } from "./DatabaseToolbarControls";
import { scheduleEditorMutation } from "../../lib/pm/scheduleEditorMutation";
import { DatabaseBlockBinding } from "./DatabaseBlockBinding";
import { DatabaseBlockDataArea } from "./DatabaseBlockDataArea";
import { DatabaseBlockFullPageHeader } from "./DatabaseBlockFullPageHeader";
import { DatabaseBlockInlineHeader } from "./DatabaseBlockInlineHeader";
import { DatabaseBlockLinkExistingPanel } from "./DatabaseBlockLinkExistingPanel";
import { DatabaseDeleteConfirmDialog } from "./DatabaseDeleteConfirmDialog";

export function DatabaseBlockView(props: NodeViewProps) {
  const { node, updateAttributes, deleteNode } = props;
  const databaseId = String(node.attrs.databaseId ?? "");
  const readOnlyTitleAttr = Boolean(node.attrs.readOnlyTitle);
  const deletionLocked = Boolean(node.attrs.deletionLocked);
  const layout = (node.attrs.layout ?? "inline") as DatabaseLayout;
  const rawView = String(node.attrs.view ?? "table");
  const view = (rawView === "list" ? "table" : rawView) as ViewKind;
  const panelStateRaw = String(node.attrs.panelState ?? "{}");
  const panelState = useMemo(
    () => parseDatabasePanelStateJson(panelStateRaw),
    [panelStateRaw],
  );
  const panelStateRef = useRef(panelState);
  panelStateRef.current = panelState;

  const bundle = useDatabaseStore((s) => s.databases[databaseId]);
  const hasDatabaseId = databaseId.length > 0;
  const needsBinding = !hasDatabaseId;
  const bundleGone = hasDatabaseId && !bundle;

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
    layout === "inline" && (readOnlyTitleAttr || dbHomePageId != null);

  const openDbHomePage = useCallback(
    (pageId: string) => {
      setActivePageNav(pageId);
      setCurrentTabPage(pageId);
    },
    [setActivePageNav, setCurrentTabPage],
  );

  const displayDbTitle = bundle?.meta.title ?? "데이터베이스";
  const deleteConfirmPhrase = useMemo(() => {
    const name = displayDbTitle.trim() || "데이터베이스";
    return `${name} 삭제`;
  }, [displayDbTitle]);

  const [titleDraft, setTitleDraft] = useState(displayDbTitle);
  useEffect(() => {
    setTitleDraft(displayDbTitle);
  }, [displayDbTitle, databaseId]);

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

  const openDeleteDatabaseModal = () => {
    setDeletePhraseDraft("");
    setDeleteModalOpen(true);
  };

  const closeDeleteDatabaseModal = () => {
    setDeleteModalOpen(false);
    setDeletePhraseDraft("");
  };

  const executeDeleteDatabasePermanently = () => {
    if (!hasDatabaseId) return;
    if (deletePhraseDraft.trim() !== deleteConfirmPhrase) {
      alert(
        `다음 문구를 정확히 입력하세요:\n「${deleteConfirmPhrase}」`,
      );
      return;
    }
    deleteDatabaseFromStore(databaseId);
    scheduleEditorMutation(() => {
      deleteNode();
    });
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
      scheduleEditorMutation(() => {
        const next = { ...panelStateRef.current, ...patch };
        panelStateRef.current = next;
        updateAttributes({ panelState: JSON.stringify(next) });
      });
    },
    [updateAttributes],
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

  const shellClass =
    layout === "fullPage"
      ? "my-4 w-[calc(100%+6rem)] max-w-none -mx-12"
      : "my-4";

  const activeViewComponent = useMemo(() => {
    if (!bundle) return null;
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
  }, [databaseId, bundle, panelState, setPanelState, view]);

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
                deletionLocked={deletionLocked}
                onToggleDeletionLock={() =>
                  scheduleEditorMutation(() =>
                    updateAttributes({ deletionLocked: !deletionLocked }),
                  )
                }
                onOpenLink={() => setLinkOpen((v) => !v)}
                onOpenDeleteModal={openDeleteDatabaseModal}
                view={view}
                onViewChange={setView}
              />
            ) : (
              <DatabaseBlockFullPageHeader
                view={view}
                onViewChange={setView}
                onOpenLink={() => setLinkOpen((v) => !v)}
                onOpenDeleteModal={openDeleteDatabaseModal}
              />
            )}

            <DatabaseToolbarControls
              databaseId={databaseId}
              panelState={panelState}
              setPanelState={setPanelState}
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
    </NodeViewWrapper>
  );
}
