import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Minus, Trash2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useMemberStore } from "../../store/memberStore";
import { useHistoryStore } from "../../store/historyStore";
import { useHistorySelection } from "../history/useHistorySelection";
import { SimpleConfirmDialog } from "../ui/SimpleConfirmDialog";
import { formatPageHistoryEditorLine } from "../../lib/historyEditorLabel";
import type { DatabaseLayout } from "../../types/database";

type Props = {
  open: boolean;
  databaseId: string;
  layout: DatabaseLayout;
  isInsidePeek: boolean;
  isProtectedDatabase: boolean;
  onClose: () => void;
  onRestoreLatest: () => void;
  onRestoreHistoryEvent: (eventId: string) => void;
  onDeletePermanently: () => void;
};

/** DB 블록의 버전 히스토리 dialog. 피커뷰 안에서도 가려지지 않도록 body Portal 로 렌더한다. */
export function DatabaseBlockHistoryDialog({
  open,
  databaseId,
  layout,
  isInsidePeek,
  isProtectedDatabase,
  onClose,
  onRestoreLatest,
  onRestoreHistoryEvent,
  onDeletePermanently,
}: Props) {
  const { members, me } = useMemberStore(
    useShallow((s) => ({ members: s.members, me: s.me })),
  );
  const dbHistoryTimeline = useHistoryStore((s) =>
    open && databaseId ? s.getDbTimeline(databaseId) : [],
  );
  const deleteDbHistoryEvents = useHistoryStore((s) => s.deleteDbHistoryEvents);
  const [dbHistoryDeleteOpen, setDbHistoryDeleteOpen] = useState(false);
  const [dbPermanentDeleteOpen, setDbPermanentDeleteOpen] = useState(false);
  const [dbHistoryDeleteTarget, setDbHistoryDeleteTarget] = useState<{
    label: string;
    eventIds: string[];
  } | null>(null);

  const dbTimelineIds = useMemo(
    () => dbHistoryTimeline.map((entry) => entry.id),
    [dbHistoryTimeline],
  );
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
  const confirmZIndex = isInsidePeek ? 730 : 500;

  if (!open || !databaseId) return null;

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
          className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="mb-3 flex items-center justify-between gap-2 text-base">
            <h2
              id="qn-db-history-title"
              className="text-base font-semibold text-zinc-900 dark:text-zinc-100"
            >
              DB 버전 히스토리
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded px-2 py-1 text-base text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              닫기
            </button>
          </div>
          <div className="mb-2 flex items-center justify-between gap-2 text-base">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onRestoreLatest}
                className="rounded border border-zinc-200 px-2 py-1 text-base hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                DB 최근 버전 복원
              </button>
              {layout === "fullPage" && (
                <button
                  type="button"
                  onClick={() => setDbPermanentDeleteOpen(true)}
                  disabled={isProtectedDatabase}
                  title={isProtectedDatabase ? "LC스케줄러 DB는 삭제할 수 없습니다." : undefined}
                  className="rounded border border-red-200 px-2 py-1 text-base text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:border-red-900/40 dark:hover:bg-red-950/30"
                >
                  영구삭제
                </button>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => toggleDbTimelineAll()}
                className="inline-flex items-center gap-1 rounded border border-zinc-200 px-2 py-1 text-base hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {selectedDbTimelineIds.size > 0 &&
                selectedDbTimelineIds.size === dbTimelineIds.length ? (
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
                  className="rounded border border-red-200 px-2 py-1 text-base text-red-600 hover:bg-red-50 dark:border-red-900/40 dark:hover:bg-red-950/30"
                >
                  선택 삭제
                </button>
              )}
            </div>
          </div>
          <div className="max-h-[55vh] overflow-y-auto rounded-md border border-zinc-200 text-base dark:border-zinc-700">
            {dbHistoryTimeline.length === 0 ? (
              <div className="px-3 py-2 text-base text-zinc-500">
                버전 기록이 없습니다.
              </div>
            ) : (
              dbHistoryTimeline.slice(0, 100).map((entry, idx, arr) => (
                <div
                  key={entry.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    const targetEventId = entry.eventIds[entry.eventIds.length - 1];
                    if (targetEventId) {
                      onRestoreHistoryEvent(targetEventId);
                    }
                    onClose();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      const targetEventId = entry.eventIds[entry.eventIds.length - 1];
                      if (targetEventId) {
                        onRestoreHistoryEvent(targetEventId);
                      }
                      onClose();
                    }
                  }}
                  className="flex w-full items-center justify-between gap-2 border-b border-zinc-100 px-3 py-2 text-left text-base last:border-b-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
                >
                  <button
                    type="button"
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
                    aria-label="히스토리 선택"
                  >
                    {selectedDbTimelineIds.has(entry.id) ? (
                      <Check size={10} strokeWidth={3} />
                    ) : null}
                  </button>
                  <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-200">
                    {`버전 ${arr.length - idx}`}
                  </span>
                  <span className="shrink-0 text-sm text-zinc-400">
                    {new Date(entry.endTs).toLocaleString()}
                  </span>
                  {(entry.lastEditedByName || entry.lastEditedByMemberId) && (
                    <span className="shrink-0 max-w-[96px] truncate text-sm text-zinc-400">
                      {formatPageHistoryEditorLine(entry, { members, me: me ?? null })}
                    </span>
                  )}
                  <button
                    type="button"
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
                  </button>
                </div>
              ))
            )}
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
          if (dbHistoryDeleteTarget) {
            deleteDbHistoryEvents(databaseId, dbHistoryDeleteTarget.eventIds);
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
          if (!isProtectedDatabase) {
            onDeletePermanently();
          }
          setDbPermanentDeleteOpen(false);
          onClose();
        }}
      />
    </>,
    document.body,
  );
}
