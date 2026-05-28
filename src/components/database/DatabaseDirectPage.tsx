import { useEffect, useMemo, useState } from "react";
import { Check, Database, History, Minus, Trash2, X } from "lucide-react";
import { DatabaseFullPageStandalone } from "./DatabaseFullPageStandalone";
import { DatabaseDeleteConfirmDialog } from "./DatabaseDeleteConfirmDialog";
import { SimpleConfirmDialog } from "../ui/SimpleConfirmDialog";
import { useHistorySelection } from "../history/useHistorySelection";
import { useDatabaseStore } from "../../store/databaseStore";
import {
  repairDbHistoryBaselineIfNeeded,
  useHistoryStore,
} from "../../store/historyStore";
import { useMemberStore } from "../../store/memberStore";
import { usePageStore } from "../../store/pageStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { formatPageHistoryEditorLine } from "../../lib/historyEditorLabel";
import { isProtectedDatabaseId } from "../../lib/scheduler/database";
import { refreshWorkspaceSnapshot } from "../../lib/sync/workspaceSwitch";

type Props = {
  databaseId: string;
};

export function DatabaseDirectPage({ databaseId }: Props) {
  const bundle = useDatabaseStore((s) => s.databases[databaseId]);
  const deleteDatabase = useDatabaseStore((s) => s.deleteDatabase);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const members = useMemberStore((s) => s.members);
  const me = useMemberStore((s) => s.me);
  const dbHistoryTimeline = useHistoryStore((s) => s.getDbTimeline(databaseId));
  const deleteDbHistoryEvents = useHistoryStore((s) => s.deleteDbHistoryEvents);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [historyDeleteOpen, setHistoryDeleteOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletePhraseDraft, setDeletePhraseDraft] = useState("");
  const [historyDeleteTarget, setHistoryDeleteTarget] = useState<{
    label: string;
    eventIds: string[];
  } | null>(null);

  const title = bundle?.meta.title ?? "데이터베이스";
  const isProtectedDatabase = isProtectedDatabaseId(databaseId);
  const deleteConfirmPhrase = useMemo(() => {
    const name = title.trim() || "데이터베이스";
    return `${name} 삭제`;
  }, [title]);
  const timelineIds = dbHistoryTimeline.map((entry) => entry.id);
  const {
    selectedIds: selectedTimelineIds,
    toggleOne: toggleTimelineOne,
    toggleAll: toggleTimelineAll,
    clearSelection: clearTimelineSelection,
  } = useHistorySelection(timelineIds);
  const selectedEntries = dbHistoryTimeline.filter((entry) =>
    selectedTimelineIds.has(entry.id),
  );
  const selectedEventIds = selectedEntries.flatMap((entry) => entry.eventIds);

  useEffect(() => {
    if (!bundle) return;
    repairDbHistoryBaselineIfNeeded(databaseId, structuredClone(bundle));
  }, [bundle, databaseId]);

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
    if (deletePhraseDraft.trim() !== deleteConfirmPhrase) {
      alert(`다음 문구를 정확히 입력하세요:\n「${deleteConfirmPhrase}」`);
      return;
    }
    deleteDatabase(databaseId);
    useSettingsStore.getState().setCurrentTabDatabase(null);
    usePageStore.getState().setActivePage(null);
    refreshSnapshotAfterDatabaseDelete();
    closeDeleteDatabaseModal();
  };

  const restoreHistoryEntry = (eventIds: string[]) => {
    const targetEventId = eventIds[eventIds.length - 1];
    if (!targetEventId) return;
    useDatabaseStore.getState().restoreDatabaseFromHistoryEvent(databaseId, targetEventId);
    setHistoryDialogOpen(false);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-white dark:bg-[#111111]">
      <div
        data-testid="database-direct-page-shell"
        className="mx-auto flex w-full max-w-none flex-col px-4 py-8"
      >
        <div className="mb-4 flex min-w-0 items-center gap-3 px-2">
          <Database size={40} className="shrink-0 text-zinc-400" />
          <h1 className="min-w-0 flex-1 truncate text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            {title}
          </h1>
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

        <DatabaseFullPageStandalone databaseId={databaseId} />
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

      {historyDialogOpen && (
        <div
          className="fixed inset-0 z-[420] flex items-center justify-center bg-black/45 p-4"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setHistoryDialogOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="qn-direct-db-history-title"
            className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2
                id="qn-direct-db-history-title"
                className="text-base font-semibold text-zinc-900 dark:text-zinc-100"
              >
                DB 버전 히스토리
              </h2>
              <button
                type="button"
                onClick={() => setHistoryDialogOpen(false)}
                className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mb-2 flex items-center justify-between gap-2 text-sm">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    useDatabaseStore.getState().restoreDatabaseFromLatestHistory(databaseId)
                  }
                  className="rounded border border-zinc-200 px-2 py-1 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  DB 최근 버전 복원
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setHistoryDialogOpen(false);
                    openDeleteDatabaseModal();
                  }}
                  disabled={isProtectedDatabase}
                  className="rounded border border-red-200 px-2 py-1 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:border-red-900/40 dark:hover:bg-red-950/30"
                >
                  DB 삭제
                </button>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => toggleTimelineAll()}
                  className="inline-flex items-center gap-1 rounded border border-zinc-200 px-2 py-1 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  {selectedTimelineIds.size > 0 &&
                  selectedTimelineIds.size === timelineIds.length ? (
                    <Check size={12} />
                  ) : selectedTimelineIds.size > 0 ? (
                    <Minus size={12} />
                  ) : (
                    <span className="inline-block h-3 w-3 rounded-sm border border-zinc-400" />
                  )}
                  전체 선택
                </button>
                {selectedTimelineIds.size > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setHistoryDeleteTarget({
                        label: `${selectedTimelineIds.size}개 선택 항목`,
                        eventIds: selectedEventIds,
                      });
                      setHistoryDeleteOpen(true);
                    }}
                    className="rounded border border-red-200 px-2 py-1 text-red-600 hover:bg-red-50 dark:border-red-900/40 dark:hover:bg-red-950/30"
                  >
                    선택 삭제
                  </button>
                )}
              </div>
            </div>

            <div className="max-h-[55vh] overflow-y-auto rounded-md border border-zinc-200 text-sm dark:border-zinc-700">
              {dbHistoryTimeline.length === 0 ? (
                <div className="px-3 py-2 text-zinc-500">버전 기록이 없습니다.</div>
              ) : (
                dbHistoryTimeline.slice(0, 100).map((entry, idx, arr) => (
                  <div
                    key={entry.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => restoreHistoryEntry(entry.eventIds)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        restoreHistoryEntry(entry.eventIds);
                      }
                    }}
                    className="flex w-full items-center gap-2 border-b border-zinc-100 px-3 py-2 text-left last:border-b-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleTimelineOne(entry.id, { shiftKey: e.shiftKey });
                      }}
                      className={[
                        "inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border",
                        selectedTimelineIds.has(entry.id)
                          ? "border-blue-500 bg-blue-500 text-white"
                          : "border-zinc-400",
                      ].join(" ")}
                      aria-label="히스토리 선택"
                    >
                      {selectedTimelineIds.has(entry.id) ? (
                        <Check size={10} strokeWidth={3} />
                      ) : null}
                    </button>
                    <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-200">
                      {`버전 ${arr.length - idx}`}
                    </span>
                    <span className="shrink-0 text-xs text-zinc-400">
                      {new Date(entry.endTs).toLocaleString()}
                    </span>
                    {(entry.lastEditedByName || entry.lastEditedByMemberId) && (
                      <span className="max-w-[96px] shrink-0 truncate text-xs text-zinc-400">
                        {formatPageHistoryEditorLine(entry, { members, me })}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setHistoryDeleteTarget({
                          label: `버전 ${arr.length - idx}`,
                          eventIds: entry.eventIds,
                        });
                        setHistoryDeleteOpen(true);
                      }}
                      className="shrink-0 rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                      title="히스토리 항목 삭제"
                      aria-label="히스토리 항목 삭제"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <SimpleConfirmDialog
        open={historyDeleteOpen}
        title="히스토리 항목 삭제"
        message={`"${historyDeleteTarget?.label ?? "선택한 항목"}" 히스토리를 삭제할까요?`}
        confirmLabel="삭제"
        danger
        onCancel={() => {
          setHistoryDeleteOpen(false);
          setHistoryDeleteTarget(null);
        }}
        onConfirm={() => {
          if (historyDeleteTarget) {
            deleteDbHistoryEvents(databaseId, historyDeleteTarget.eventIds);
          }
          setHistoryDeleteOpen(false);
          setHistoryDeleteTarget(null);
          clearTimelineSelection();
        }}
      />
    </div>
  );
}
