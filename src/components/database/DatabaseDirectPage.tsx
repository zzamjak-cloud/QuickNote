import { useEffect, useMemo, useRef, useState } from "react";
import { Database, History, Trash2 } from "lucide-react";
import { DatabaseFullPageStandalone } from "./DatabaseFullPageStandalone";
import { DatabaseDeleteConfirmDialog } from "./DatabaseDeleteConfirmDialog";
import { DatabaseBlockHistoryDialog } from "./DatabaseBlockHistoryDialog";
import { useDatabaseStore } from "../../store/databaseStore";
import { usePageStore } from "../../store/pageStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { isProtectedDatabaseId } from "../../lib/scheduler/database";
import { refreshWorkspaceSnapshot } from "../../lib/sync/workspaceSwitch";
import { normalizeConfirmPhrase } from "../../lib/text/normalizeConfirmPhrase";
import type { ViewKind } from "../../types/database";

type Props = {
  databaseId: string;
  pageId?: string;
};

function isViewKind(value: unknown): value is ViewKind {
  return (
    value === "table" ||
    value === "kanban" ||
    value === "timeline" ||
    value === "gallery" ||
    value === "list"
  );
}

export function DatabaseDirectPage({ databaseId, pageId }: Props) {
  const bundle = useDatabaseStore((s) => s.databases[databaseId]);
  const deleteDatabase = useDatabaseStore((s) => s.deleteDatabase);
  const setDatabaseTitle = useDatabaseStore((s) => s.setDatabaseTitle);
  const fullPageAttrs = usePageStore((s) => {
    if (!pageId) return null;
    const first = s.pages[pageId]?.doc.content?.[0];
    if (first?.type !== "databaseBlock") return null;
    const attrs = first.attrs as Record<string, unknown> | undefined;
    if (!attrs || attrs.layout !== "fullPage") return null;
    if (attrs.databaseId !== databaseId) return null;
    return {
      view: isViewKind(attrs.view) ? attrs.view : "table",
      panelStateRaw: typeof attrs.panelState === "string" ? attrs.panelState : "{}",
    };
  });
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletePhraseDraft, setDeletePhraseDraft] = useState("");
  const [titleHovered, setTitleHovered] = useState(false);
  const [titleFocused, setTitleFocused] = useState(false);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  const title = bundle?.meta.title ?? "데이터베이스";
  const isProtectedDatabase = isProtectedDatabaseId(databaseId);

  useEffect(() => {
    const input = titleInputRef.current;
    if (!input || document.activeElement === input) return;
    input.value = title;
  }, [title]);

  useEffect(() => {
    if (!titleFocused) return;
    const handleOutside = (e: MouseEvent) => {
      if (titleInputRef.current && !titleInputRef.current.contains(e.target as Node)) {
        titleInputRef.current.blur();
      }
    };
    document.addEventListener("mousedown", handleOutside, true);
    return () => document.removeEventListener("mousedown", handleOutside, true);
  }, [titleFocused]);

  const commitTitle = (draft: string) => {
    const next = draft.trim() || "제목 없음";
    const ok = setDatabaseTitle(databaseId, next);
    if (!ok) {
      alert("이미 사용 중인 데이터베이스 이름입니다.");
      if (titleInputRef.current) titleInputRef.current.value = title;
    }
  };
  const deleteConfirmPhrase = useMemo(() => {
    const name = normalizeConfirmPhrase(title) || "데이터베이스";
    return `${name} 삭제`;
  }, [title]);
  const refreshSnapshotAfterDatabaseDelete = () => {
    if (!currentWorkspaceId) return;
    window.setTimeout(() => refreshWorkspaceSnapshot(currentWorkspaceId), 0);
  };

  const openDeleteDatabaseModal = () => {
    if (isProtectedDatabase) return;
    setDeletePhraseDraft("");
    setDeleteModalOpen(true);
  };

  const closeDeleteDatabaseModal = () => {
    setDeleteModalOpen(false);
    setDeletePhraseDraft("");
  };

  const executeDeleteDatabase = () => {
    if (isProtectedDatabase) return;
    if (normalizeConfirmPhrase(deletePhraseDraft) !== deleteConfirmPhrase) {
      alert(`다음 문구를 정확히 입력하세요:\n「${deleteConfirmPhrase}」`);
      return;
    }
    deleteDatabase(databaseId);
    useSettingsStore.getState().setCurrentTabDatabase(null);
    usePageStore.getState().setActivePage(null);
    refreshSnapshotAfterDatabaseDelete();
    closeDeleteDatabaseModal();
  };

  return (
    <div className="flex-1 overflow-y-auto bg-white dark:bg-[#111111]">
      <div
        data-testid="database-direct-page-shell"
        className="mx-auto flex w-full max-w-none flex-col px-4 pt-8 pb-28"
      >
        <div className="mb-4 flex min-w-0 items-center gap-3 px-2">
          <Database size={40} className="shrink-0 text-zinc-400" />
          {isProtectedDatabase ? (
            <h1 className="min-w-0 flex-1 truncate text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              {title}
            </h1>
          ) : (
            <input
              ref={titleInputRef}
              type="text"
              defaultValue={title}
              onMouseEnter={() => setTitleHovered(true)}
              onMouseLeave={() => setTitleHovered(false)}
              onFocus={() => setTitleFocused(true)}
              onBlur={() => {
                setTitleFocused(false);
                setTitleHovered(false);
                commitTitle(titleInputRef.current?.value ?? title);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              placeholder="데이터베이스 이름"
              title="이름 변경"
              className={[
                "min-w-0 flex-1 cursor-text rounded-md border bg-transparent px-2 text-4xl font-bold tracking-tight text-zinc-900 outline-none dark:text-zinc-100",
                titleFocused
                  ? "border-zinc-300 dark:border-zinc-600"
                  : titleHovered
                    ? "border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/40"
                    : "border-transparent",
              ].join(" ")}
            />
          )}
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              aria-label="DB 버전 히스토리"
              title="DB 버전 히스토리"
              onClick={() => setHistoryDialogOpen(true)}
              className="rounded-md p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <History size={18} />
            </button>
            <button
              type="button"
              aria-label="데이터베이스 삭제"
              title={
                isProtectedDatabase
                  ? "LC스케줄러 DB는 삭제할 수 없습니다."
                  : "데이터베이스 삭제"
              }
              onClick={openDeleteDatabaseModal}
              disabled={isProtectedDatabase}
              className="rounded-md p-2 text-zinc-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-zinc-400 dark:hover:bg-red-950/40 dark:hover:text-red-400"
            >
              <Trash2 size={18} />
            </button>
          </div>
        </div>

        <DatabaseFullPageStandalone
          pageId={fullPageAttrs ? pageId : undefined}
          databaseId={databaseId}
          view={fullPageAttrs?.view}
          panelStateRaw={fullPageAttrs?.panelStateRaw}
        />
      </div>

      <DatabaseDeleteConfirmDialog
        open={deleteModalOpen}
        bundleTitle={title}
        deleteConfirmPhrase={deleteConfirmPhrase}
        deletePhraseDraft={deletePhraseDraft}
        onDeletePhraseChange={setDeletePhraseDraft}
        onClose={closeDeleteDatabaseModal}
        onConfirmDelete={executeDeleteDatabase}
      />

      <DatabaseBlockHistoryDialog
        open={historyDialogOpen}
        databaseId={databaseId}
        layout="fullPage"
        isInsidePeek={false}
        isProtectedDatabase={isProtectedDatabase}
        onClose={() => setHistoryDialogOpen(false)}
        onDeletePermanently={executeDeleteDatabase}
      />
    </div>
  );
}
