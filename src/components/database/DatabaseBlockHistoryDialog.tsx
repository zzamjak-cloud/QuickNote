import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Minus, RotateCcw, Trash2, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useDatabaseStore } from "../../store/databaseStore";
import { useMemberStore } from "../../store/memberStore";
import { useServerDatabaseHistoryStore } from "../../store/serverDatabaseHistoryStore";
import { useHistorySelection } from "../history/useHistorySelection";
import { SimpleConfirmDialog } from "../ui/SimpleConfirmDialog";
import { formatPageHistoryEditorLine } from "../../lib/historyEditorLabel";
import {
  buildDatabaseHistorySnapshotMap,
  getPreviousDatabaseHistorySnapshot,
} from "../../lib/history/databaseHistoryPatch";
import { buildDatabasePreviewChanges } from "../../lib/history/historyPreviewDiff";
import type { GqlDatabaseHistoryEntry } from "../../lib/sync/graphql/operations";
import type { DatabaseLayout } from "../../types/database";

const EMPTY_ENTRIES: GqlDatabaseHistoryEntry[] = [];

type Props = {
  open: boolean;
  databaseId: string;
  layout: DatabaseLayout;
  isInsidePeek: boolean;
  isProtectedDatabase: boolean;
  onClose: () => void;
  onDeletePermanently: () => void;
};

export function DatabaseBlockHistoryDialog({
  open,
  databaseId,
  layout,
  isInsidePeek,
  isProtectedDatabase,
  onClose,
  onDeletePermanently,
}: Props) {
  const bundle = useDatabaseStore((s) => s.databases[databaseId]);
  const workspaceId = bundle?.meta.workspaceId ?? "";
  const { members, me } = useMemberStore(
    useShallow((s) => ({ members: s.members, me: s.me })),
  );
  const dbHistoryTimeline = useServerDatabaseHistoryStore((s) =>
    open && databaseId ? s.getDatabaseTimeline(databaseId) : [],
  );
  const historyEntries = useServerDatabaseHistoryStore(
    (s) => s.byDatabaseId[databaseId] ?? EMPTY_ENTRIES,
  );
  const loading = useServerDatabaseHistoryStore((s) => Boolean(s.loading[databaseId]));
  const seeding = useServerDatabaseHistoryStore((s) => Boolean(s.seeding[databaseId]));
  const error = useServerDatabaseHistoryStore((s) => s.error[databaseId] ?? null);
  const fetchDatabaseHistory = useServerDatabaseHistoryStore((s) => s.fetchDatabaseHistory);
  const restoreDatabaseHistoryEvent = useServerDatabaseHistoryStore((s) => s.restoreDatabaseHistoryEvent);
  const deleteDatabaseHistoryEvents = useServerDatabaseHistoryStore((s) => s.deleteDatabaseHistoryEvents);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [dbHistoryDeleteOpen, setDbHistoryDeleteOpen] = useState(false);
  const [dbPermanentDeleteOpen, setDbPermanentDeleteOpen] = useState(false);
  const [dbHistoryDeleteTarget, setDbHistoryDeleteTarget] = useState<{
    label: string;
    eventIds: string[];
  } | null>(null);

  useEffect(() => {
    if (!open || !databaseId || !workspaceId) return;
    void fetchDatabaseHistory(databaseId, workspaceId);
  }, [databaseId, fetchDatabaseHistory, open, workspaceId]);

  const dbTimelineIds = useMemo(
    () => dbHistoryTimeline.map((entry) => entry.id),
    [dbHistoryTimeline],
  );
  const dbTimelineKey = dbTimelineIds.join("|");
  useEffect(() => {
    if (!open) return;
    setSelectedHistoryId((prev) => {
      if (prev && dbTimelineIds.includes(prev)) return prev;
      return dbTimelineIds[0] ?? null;
    });
  }, [dbTimelineIds, dbTimelineKey, open]);

  const {
    selectedIds: selectedDbTimelineIds,
    toggleOne: toggleDbTimelineOne,
    toggleAll: toggleDbTimelineAll,
    clearSelection: clearDbTimelineSelection,
  } = useHistorySelection(dbTimelineIds);
  const selectedDbTimelineEntries = useMemo(
    () => dbHistoryTimeline.filter((entry) => selectedDbTimelineIds.has(entry.id)),
    [dbHistoryTimeline, selectedDbTimelineIds],
  );
  const selectedDbEventIds = useMemo(
    () => selectedDbTimelineEntries.flatMap((entry) => entry.eventIds),
    [selectedDbTimelineEntries],
  );

  const snapshotMap = useMemo(
    () => buildDatabaseHistorySnapshotMap(historyEntries, databaseId, workspaceId),
    [databaseId, historyEntries, workspaceId],
  );
  const selectedAfter = selectedHistoryId ? snapshotMap.get(selectedHistoryId) ?? null : null;
  const selectedBefore = selectedHistoryId
    ? getPreviousDatabaseHistorySnapshot(historyEntries, databaseId, workspaceId, selectedHistoryId)
    : null;
  const previewChanges = useMemo(
    () => buildDatabasePreviewChanges(selectedBefore, selectedAfter),
    [selectedAfter, selectedBefore],
  );
  const confirmZIndex = isInsidePeek ? 730 : 500;

  if (!open || !databaseId) return null;

  const canRestore = Boolean(selectedHistoryId && workspaceId && selectedAfter);

  return createPortal(
    <>
      <div
        className={`fixed inset-0 ${isInsidePeek ? "z-[700]" : "z-[420]"} flex items-center justify-center bg-black/45 p-4`}
        role="presentation"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="qn-db-history-title"
          className="flex max-h-[86vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <h2 id="qn-db-history-title" className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              DB 버전 히스토리
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
              aria-label="닫기"
            >
              <X size={16} />
            </button>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_300px] overflow-hidden">
            <div className="min-w-0 overflow-y-auto p-4">
              {loading ? (
                <div className="text-sm text-zinc-500">불러오는 중...</div>
              ) : error ? (
                <div className="text-sm text-red-600">{error}</div>
              ) : seeding ? (
                <div className="text-sm text-zinc-500">초기 버전을 생성 중입니다...</div>
              ) : !selectedHistoryId ? (
                <div className="text-sm text-zinc-500">버전 기록이 없습니다.</div>
              ) : !selectedAfter ? (
                <div className="text-sm text-zinc-500">선택한 버전의 프리뷰를 만들 수 없습니다.</div>
              ) : previewChanges.length === 0 ? (
                <div className="text-sm text-zinc-500">표시할 DB 구조 변경이 없습니다.</div>
              ) : (
                <div className="space-y-2">
                  {previewChanges.map((change) => (
                    <div
                      key={change.id}
                      className="rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950"
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                          {change.label}
                        </span>
                        <span
                          className={[
                            "shrink-0 rounded px-1.5 py-0.5 text-xs",
                            change.kind === "added"
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                              : change.kind === "removed"
                                ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                                : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
                          ].join(" ")}
                        >
                          {change.kind === "added" ? "추가" : change.kind === "removed" ? "삭제" : "변경"}
                        </span>
                      </div>
                      <div className="grid gap-2 text-sm md:grid-cols-2">
                        <div className="min-w-0 rounded bg-red-50/70 p-2 text-red-900 dark:bg-red-950/25 dark:text-red-100">
                          <div className="break-words">{change.before}</div>
                        </div>
                        <div className="min-w-0 rounded bg-emerald-50/70 p-2 text-emerald-900 dark:bg-emerald-950/25 dark:text-emerald-100">
                          <div className="break-words">{change.after}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex min-h-0 flex-col border-l border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center justify-between gap-2 border-b border-zinc-200 p-3 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => toggleDbTimelineAll()}
                  className="inline-flex items-center gap-1 rounded border border-zinc-200 px-2 py-1 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  {selectedDbTimelineIds.size > 0 && selectedDbTimelineIds.size === dbTimelineIds.length ? (
                    <Check size={12} />
                  ) : selectedDbTimelineIds.size > 0 ? (
                    <Minus size={12} />
                  ) : (
                    <span className="inline-block h-3 w-3 rounded-sm border border-zinc-400" />
                  )}
                  전체 선택
                </button>
                {selectedDbTimelineIds.size > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setDbHistoryDeleteTarget({
                        label: `${selectedDbTimelineIds.size}개 선택 항목`,
                        eventIds: selectedDbEventIds,
                      });
                      setDbHistoryDeleteOpen(true);
                    }}
                    className="rounded border border-red-200 px-2 py-1 text-sm text-red-600 hover:bg-red-50 dark:border-red-900/40 dark:hover:bg-red-950/30"
                  >
                    선택 삭제
                  </button>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {seeding ? (
                  <div className="px-3 py-2 text-sm text-zinc-500">초기 버전을 생성 중입니다...</div>
                ) : dbHistoryTimeline.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-zinc-500">버전 기록이 없습니다.</div>
                ) : (
                  dbHistoryTimeline.slice(0, 100).map((entry, idx, arr) => {
                    const active = selectedHistoryId === entry.id;
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => setSelectedHistoryId(entry.id)}
                        className={[
                          "flex w-full items-center gap-2 border-b border-zinc-100 px-3 py-2 text-left text-sm last:border-b-0 dark:border-zinc-800",
                          active ? "bg-zinc-100 dark:bg-zinc-800" : "hover:bg-zinc-50 dark:hover:bg-zinc-800",
                        ].join(" ")}
                      >
                        <span
                          role="checkbox"
                          aria-checked={selectedDbTimelineIds.has(entry.id)}
                          tabIndex={-1}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleDbTimelineOne(entry.id, { shiftKey: e.shiftKey });
                          }}
                          className={[
                            "inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border",
                            selectedDbTimelineIds.has(entry.id)
                              ? "border-blue-500 bg-blue-500 text-white"
                              : "border-zinc-400",
                          ].join(" ")}
                        >
                          {selectedDbTimelineIds.has(entry.id) ? <Check size={10} strokeWidth={3} /> : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-zinc-700 dark:text-zinc-200">{`버전 ${arr.length - idx}`}</span>
                          <span className="block truncate text-xs text-zinc-400">
                            {new Date(entry.endTs).toLocaleString()}
                          </span>
                        </span>
                        {(entry.lastEditedByName || entry.lastEditedByMemberId) && (
                          <span className="max-w-[72px] shrink-0 truncate text-xs text-zinc-400">
                            {formatPageHistoryEditorLine(entry, { members, me: me ?? null })}
                          </span>
                        )}
                        <span
                          role="button"
                          tabIndex={-1}
                          onClick={(e) => {
                            e.stopPropagation();
                            setDbHistoryDeleteTarget({
                              label: `버전 ${arr.length - idx}`,
                              eventIds: entry.eventIds,
                            });
                            setDbHistoryDeleteOpen(true);
                          }}
                          className="shrink-0 rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                          title="히스토리 항목 삭제"
                          aria-label="히스토리 항목 삭제"
                        >
                          <Trash2 size={12} />
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800">
                {layout === "fullPage" ? (
                  <button
                    type="button"
                    onClick={() => setDbPermanentDeleteOpen(true)}
                    disabled={isProtectedDatabase}
                    title={isProtectedDatabase ? "LC스케줄러 DB는 삭제할 수 없습니다." : undefined}
                    className="rounded border border-red-200 px-2 py-1 text-sm text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:border-red-900/40 dark:hover:bg-red-950/30"
                  >
                    영구삭제
                  </button>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  disabled={!canRestore}
                  onClick={() => {
                    if (!selectedHistoryId || !workspaceId) return;
                    void restoreDatabaseHistoryEvent(databaseId, workspaceId, selectedHistoryId).then(() => onClose());
                  }}
                  className="inline-flex items-center gap-1 rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                >
                  <RotateCcw size={14} />
                  복원
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <SimpleConfirmDialog
        open={dbHistoryDeleteOpen}
        title="히스토리 항목 삭제"
        message={`"${dbHistoryDeleteTarget?.label ?? "선택한 항목"}" 히스토리를 삭제할까요?`}
        confirmLabel="삭제"
        danger
        zIndex={confirmZIndex}
        onCancel={() => {
          setDbHistoryDeleteOpen(false);
          setDbHistoryDeleteTarget(null);
        }}
        onConfirm={() => {
          if (dbHistoryDeleteTarget && workspaceId) {
            void deleteDatabaseHistoryEvents(databaseId, workspaceId, dbHistoryDeleteTarget.eventIds);
          }
          setDbHistoryDeleteOpen(false);
          setDbHistoryDeleteTarget(null);
          clearDbTimelineSelection();
        }}
      />
      <SimpleConfirmDialog
        open={dbPermanentDeleteOpen}
        title="데이터베이스 영구삭제"
        message="이 데이터베이스와 모든 히스토리를 완전히 삭제합니다. 복구가 불가능합니다. 계속할까요?"
        confirmLabel="영구삭제"
        danger
        zIndex={confirmZIndex}
        onCancel={() => setDbPermanentDeleteOpen(false)}
        onConfirm={() => {
          if (!isProtectedDatabase) onDeletePermanently();
          setDbPermanentDeleteOpen(false);
          onClose();
        }}
      />
    </>,
    document.body,
  );
}
