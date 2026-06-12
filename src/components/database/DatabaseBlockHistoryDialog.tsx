import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Minus, RotateCcw, Trash2, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useDatabaseStore } from "../../store/databaseStore";
import { useMemberStore } from "../../store/memberStore";
import { usePageStore } from "../../store/pageStore";
import { useServerDatabaseHistoryStore } from "../../store/serverDatabaseHistoryStore";
import { useServerDatabaseRowHistoryStore } from "../../store/serverDatabaseRowHistoryStore";
import { useServerPageHistoryStore } from "../../store/serverPageHistoryStore";
import { useHistorySelection } from "../history/useHistorySelection";
import { SimpleConfirmDialog } from "../ui/SimpleConfirmDialog";
import { formatPageHistoryEditorLine } from "../../lib/historyEditorLabel";
import {
  buildDatabaseHistorySnapshotMap,
  getPreviousDatabaseHistorySnapshot,
} from "../../lib/history/databaseHistoryPatch";
import {
  buildPageHistorySnapshotMap,
  getPreviousPageHistorySnapshot,
} from "../../lib/history/pageHistoryPatch";
import {
  buildDatabasePreviewChanges,
  buildPagePreviewChanges,
  summarizePreviewChanges,
  type HistoryPreviewChange,
} from "../../lib/history/historyPreviewDiff";
import type { GqlDatabaseHistoryEntry, GqlPageHistoryEntry } from "../../lib/sync/graphql/operations";
import type { DatabaseLayout } from "../../types/database";
import { summarizeChangedUnits } from "../../lib/history/blockDiff";
import { BlockDiffView } from "../history/BlockDiffView";
import { DatabaseStructureDiffView } from "./DatabaseStructureDiffView";

const EMPTY_ENTRIES: GqlDatabaseHistoryEntry[] = [];
const EMPTY_PAGE_ENTRIES: GqlPageHistoryEntry[] = [];

type Props = {
  open: boolean;
  databaseId: string;
  layout: DatabaseLayout;
  isInsidePeek: boolean;
  isProtectedDatabase: boolean;
  onClose: () => void;
  onDeletePermanently: () => void;
};

/** 변경 카드 목록 렌더 — DB 구조/페이지 프리뷰 공통 */
function PreviewChangeList({ changes }: { changes: HistoryPreviewChange[] }) {
  return (
    <div className="space-y-2">
      {changes.map((change) => (
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
  );
}

function PreviewHint({ text }: { text: string }) {
  return <div className="text-sm text-zinc-500">{text}</div>;
}

/** 히스토리 리스트 라벨 색상 — 삭제=빨강, 생성=파랑, 그 외 기본 */
function historyLabelColorClass(kind: string): string {
  if (kind === "page.delete") return "text-red-600 dark:text-red-400";
  if (kind === "page.create") return "text-blue-600 dark:text-blue-400";
  return "text-zinc-700 dark:text-zinc-200";
}

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
  const databases = useDatabaseStore((s) => s.databases);
  const pages = usePageStore((s) => s.pages);
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

  // "DB구조"(DB 스냅샷) / "페이지"(row 페이지 변경) 두 투영
  const [historyTab, setHistoryTab] = useState<"structure" | "rows">("structure");
  const [selectedRow, setSelectedRow] = useState<{ pageId: string; historyId: string } | null>(null);

  const rowActivity = useServerDatabaseRowHistoryStore((s) =>
    open && databaseId ? s.getRowActivity(databaseId) : [],
  );
  const rowLoading = useServerDatabaseRowHistoryStore((s) => Boolean(s.loading[databaseId]));
  const rowHasMore = useServerDatabaseRowHistoryStore((s) => s.hasMore(databaseId));
  const fetchDatabaseRowActivity = useServerDatabaseRowHistoryStore((s) => s.fetchDatabaseRowActivity);
  const loadMoreDatabaseRowActivity = useServerDatabaseRowHistoryStore(
    (s) => s.loadMoreDatabaseRowActivity,
  );

  // 선택된 row 페이지의 상세 히스토리(인라인 프리뷰용)
  const pageHistoryEntries = useServerPageHistoryStore((s) =>
    selectedRow ? s.byPageId[selectedRow.pageId] ?? EMPTY_PAGE_ENTRIES : EMPTY_PAGE_ENTRIES,
  );
  const pageHistoryLoading = useServerPageHistoryStore((s) =>
    selectedRow ? Boolean(s.loading[selectedRow.pageId]) : false,
  );
  const fetchPageHistory = useServerPageHistoryStore((s) => s.fetchPageHistory);
  const restorePageHistoryEvent = useServerPageHistoryStore((s) => s.restorePageHistoryEvent);

  useEffect(() => {
    if (!open || historyTab !== "rows" || !databaseId || !workspaceId) return;
    void fetchDatabaseRowActivity(databaseId, workspaceId);
  }, [open, historyTab, databaseId, workspaceId, fetchDatabaseRowActivity]);

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

  // 페이지 탭: 첫 항목 자동 선택(클릭 전에도 프리뷰가 보이도록)
  const rowActivityKey = useMemo(() => rowActivity.map((e) => e.id).join("|"), [rowActivity]);
  useEffect(() => {
    if (!open || historyTab !== "rows") return;
    setSelectedRow((prev) => {
      if (prev && rowActivity.some((e) => e.id === prev.historyId)) return prev;
      const first = rowActivity[0];
      return first ? { pageId: first.rowPageId, historyId: first.id } : null;
    });
    // rowActivity 는 rowActivityKey(id 목록)로 안정 식별
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, historyTab, rowActivityKey]);

  // 선택된 row 페이지의 상세 히스토리 로드
  useEffect(() => {
    if (!open || historyTab !== "rows" || !selectedRow || !workspaceId) return;
    void fetchPageHistory(selectedRow.pageId, workspaceId);
  }, [open, historyTab, selectedRow, workspaceId, fetchPageHistory]);

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

  // DB 구조 버전별 변경 요약(리스트에 "무엇이 바뀌었나" 표시)
  const dbSummaries = useMemo(() => {
    const asc = [...historyEntries]
      .filter((e) => e.workspaceId === workspaceId)
      .sort(
        (a, b) =>
          (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0) ||
          a.historyId.localeCompare(b.historyId),
      );
    const map = new Map<string, string>();
    let prev: ReturnType<typeof snapshotMap.get> | null = null;
    for (const e of asc) {
      const cur = snapshotMap.get(e.historyId) ?? null;
      // 첫 버전(이전 스냅샷 없음)은 요약 대신 항목 라벨("DB 생성")로 폴백.
      const summary = prev === null ? "" : summarizePreviewChanges(buildDatabasePreviewChanges(prev, cur));
      map.set(e.historyId, summary);
      if (cur) prev = cur;
    }
    return map;
  }, [historyEntries, snapshotMap, workspaceId]);

  // 페이지 탭 인라인 프리뷰 계산
  const pageSnapshotMap = useMemo(
    () =>
      selectedRow && workspaceId
        ? buildPageHistorySnapshotMap(pageHistoryEntries, selectedRow.pageId, workspaceId)
        : new Map(),
    [pageHistoryEntries, selectedRow, workspaceId],
  );
  const pageAfter = selectedRow ? pageSnapshotMap.get(selectedRow.historyId) ?? null : null;
  const pageBefore =
    selectedRow && workspaceId
      ? getPreviousPageHistorySnapshot(pageHistoryEntries, selectedRow.pageId, workspaceId, selectedRow.historyId)
      : null;
  const pageCtx = useMemo(() => {
    const dbId = pageAfter?.databaseId ?? pageBefore?.databaseId ?? databaseId;
    const b = dbId ? databases[dbId] : null;
    const colMap = new Map((b?.columns ?? []).map((c) => [c.id, c]));
    return {
      getDatabaseTitle: (id: string) => databases[id]?.meta.title ?? null,
      getPageTitle: (id: string) => pages[id]?.title ?? null,
      getColumnName: (columnId: string) => colMap.get(columnId)?.name ?? null,
      getOptionLabel: (columnId: string, optionId: string) =>
        colMap.get(columnId)?.config?.options?.find((o) => o.id === optionId)?.label ?? null,
    };
  }, [databases, pages, pageAfter, pageBefore, databaseId]);
  const pagePreviewChanges = useMemo(
    () => buildPagePreviewChanges(pageBefore, pageAfter, pageCtx),
    [pageBefore, pageAfter, pageCtx],
  );
  // 본문은 BlockDiffView 가 실제 블럭 모습으로 렌더 — 텍스트 라인 diff(doc:*)는 제외.
  const pageMetaChanges = useMemo(
    () => pagePreviewChanges.filter((change) => !change.id.startsWith("doc:")),
    [pagePreviewChanges],
  );

  const confirmZIndex = isInsidePeek ? 730 : 500;

  if (!open || !databaseId) return null;

  const canRestoreStructure = Boolean(selectedHistoryId && workspaceId && selectedAfter);
  const canRestoreRow = Boolean(selectedRow && workspaceId && pageAfter);

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
          className="flex h-[86vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
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
              {historyTab === "rows" ? (
                !selectedRow ? (
                  <PreviewHint text="페이지 변경 항목을 선택하세요." />
                ) : pageHistoryLoading && pageHistoryEntries.length === 0 ? (
                  <PreviewHint text="불러오는 중..." />
                ) : !pageAfter ? (
                  <PreviewHint text="선택한 버전의 프리뷰를 만들 수 없습니다." />
                ) : pagePreviewChanges.length === 0 ? (
                  <PreviewHint text="표시할 변경 내용이 없습니다." />
                ) : (
                  <div className="space-y-2">
                    <PreviewChangeList changes={pageMetaChanges} />
                    <BlockDiffView beforeDoc={pageBefore?.doc} afterDoc={pageAfter?.doc} />
                  </div>
                )
              ) : loading ? (
                <PreviewHint text="불러오는 중..." />
              ) : error ? (
                <div className="text-sm text-red-600">{error}</div>
              ) : seeding ? (
                <PreviewHint text="초기 버전을 생성 중입니다..." />
              ) : !selectedHistoryId ? (
                <PreviewHint text="버전 기록이 없습니다." />
              ) : !selectedAfter ? (
                <PreviewHint text="선택한 버전의 프리뷰를 만들 수 없습니다." />
              ) : previewChanges.length === 0 ? (
                <PreviewHint text="표시할 DB 구조 변경이 없습니다." />
              ) : (
                <div className="space-y-2">
                  <DatabaseStructureDiffView before={selectedBefore} after={selectedAfter} />
                  <PreviewChangeList changes={previewChanges} />
                </div>
              )}
            </div>

            <div className="flex min-h-0 flex-col border-l border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center gap-1 border-b border-zinc-200 p-2 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setHistoryTab("structure")}
                  className={[
                    "flex-1 rounded px-2 py-1 text-sm",
                    historyTab === "structure"
                      ? "bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                      : "text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/60",
                  ].join(" ")}
                >
                  DB구조
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryTab("rows")}
                  className={[
                    "flex-1 rounded px-2 py-1 text-sm",
                    historyTab === "rows"
                      ? "bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                      : "text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/60",
                  ].join(" ")}
                >
                  페이지
                </button>
              </div>
              {historyTab === "structure" && (
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
              )}
              <div className="min-h-0 flex-1 overflow-y-auto">
                {historyTab === "rows" ? (
                  rowLoading && rowActivity.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-zinc-500">불러오는 중...</div>
                  ) : rowActivity.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-zinc-500">페이지 변경 내역이 없습니다.</div>
                  ) : (
                    <>
                      {rowActivity.map((entry) => {
                        const active = selectedRow?.historyId === entry.id;
                        return (
                          <button
                            key={entry.id}
                            type="button"
                            onClick={() => setSelectedRow({ pageId: entry.rowPageId, historyId: entry.id })}
                            className={[
                              "flex w-full items-center gap-2 border-b border-zinc-100 px-3 py-2 text-left text-sm last:border-b-0 dark:border-zinc-800",
                              active ? "bg-zinc-100 dark:bg-zinc-800" : "hover:bg-zinc-50 dark:hover:bg-zinc-800",
                            ].join(" ")}
                          >
                            <span className="min-w-0 flex-1">
                              <span className={`block truncate ${historyLabelColorClass(entry.representativeKind)}`}>
                                {entry.label}
                              </span>
                              <span className="block truncate text-xs text-zinc-400">
                                {new Date(entry.endTs).toLocaleString()}
                              </span>
                            </span>
                            {(entry.lastEditedByName || entry.lastEditedByMemberId) && (
                              <span className="max-w-[72px] shrink-0 truncate text-xs text-zinc-400">
                                {formatPageHistoryEditorLine(entry, { members, me: me ?? null })}
                              </span>
                            )}
                          </button>
                        );
                      })}
                      {rowHasMore && (
                        <button
                          type="button"
                          disabled={rowLoading}
                          onClick={() => {
                            if (workspaceId) void loadMoreDatabaseRowActivity(databaseId, workspaceId);
                          }}
                          className="w-full px-3 py-2 text-center text-sm text-zinc-500 hover:bg-zinc-50 disabled:opacity-50 dark:hover:bg-zinc-800"
                        >
                          {rowLoading ? "불러오는 중..." : "더 보기"}
                        </button>
                      )}
                    </>
                  )
                ) : seeding ? (
                  <div className="px-3 py-2 text-sm text-zinc-500">초기 버전을 생성 중입니다...</div>
                ) : dbHistoryTimeline.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-zinc-500">버전 기록이 없습니다.</div>
                ) : (
                  dbHistoryTimeline.slice(0, 100).map((entry) => {
                    const active = selectedHistoryId === entry.id;
                    // 세션 엔트리는 서버가 미리 계산한 changedUnits 요약을 우선 사용한다.
                    const rawEntry = historyEntries.find((e) => e.historyId === entry.id);
                    const summary =
                      summarizeChangedUnits(rawEntry?.changedUnits) ||
                      dbSummaries.get(entry.id) ||
                      entry.label;
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
                          <span className="block truncate text-zinc-700 dark:text-zinc-200">{summary}</span>
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
                              label: summary || "선택 버전",
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
                {historyTab === "structure" ? (
                  <button
                    type="button"
                    disabled={!canRestoreStructure}
                    onClick={() => {
                      if (!selectedHistoryId || !workspaceId) return;
                      void restoreDatabaseHistoryEvent(databaseId, workspaceId, selectedHistoryId).then(() => onClose());
                    }}
                    className="inline-flex items-center gap-1 rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                  >
                    <RotateCcw size={14} />
                    복원
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!canRestoreRow}
                    onClick={() => {
                      if (!selectedRow || !workspaceId) return;
                      void restorePageHistoryEvent(selectedRow.pageId, workspaceId, selectedRow.historyId).then(
                        () => onClose(),
                      );
                    }}
                    className="inline-flex items-center gap-1 rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                  >
                    <RotateCcw size={14} />
                    이 버전으로 복원
                  </button>
                )}
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
