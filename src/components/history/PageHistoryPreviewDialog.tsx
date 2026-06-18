import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Minus, RotateCcw, Trash2, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useMemberStore } from "../../store/memberStore";
import { buildPageTimeline, useServerPageHistoryStore } from "../../store/serverPageHistoryStore";
import { useHistorySelection } from "./useHistorySelection";
import { SimpleConfirmDialog } from "../ui/SimpleConfirmDialog";
import { formatPageHistoryEditorLine } from "../../lib/historyEditorLabel";
import { buildPageHistorySnapshotMap } from "../../lib/history/pageHistoryPatch";
import {
  buildPagePreviewChanges,
  buildPagePropertyRows,
  summarizePreviewChanges,
} from "../../lib/history/historyPreviewDiff";
import { parseContributors, summarizeChangedUnits } from "../../lib/history/blockDiff";
import { UnifiedBlockDiffView } from "./BlockDiffView";
import { useDatabaseStore } from "../../store/databaseStore";
import { usePageStore } from "../../store/pageStore";
import type { GqlPageHistoryEntry } from "../../lib/sync/graphql/operations";

const EMPTY_ENTRIES: GqlPageHistoryEntry[] = [];

type Props = {
  open: boolean;
  pageId: string | null;
  workspaceId: string | null;
  isInsidePeek?: boolean;
  onClose: () => void;
};

export function PageHistoryPreviewDialog({
  open,
  pageId,
  workspaceId,
  isInsidePeek = false,
  onClose,
}: Props) {
  const { members, me } = useMemberStore(
    useShallow((s) => ({ members: s.members, me: s.me })),
  );
  const historyEntries = useServerPageHistoryStore(
    (s) => (pageId ? s.byPageId[pageId] ?? EMPTY_ENTRIES : EMPTY_ENTRIES),
  );
  // 셀렉터가 매번 새 배열을 반환하지 않도록, 안정적인 원본 배열을 받아 useMemo 로 변환한다.
  const pageHistoryTimeline = useMemo(
    () => (open && pageId ? buildPageTimeline(historyEntries) : []),
    [open, pageId, historyEntries],
  );
  const loading = useServerPageHistoryStore((s) => Boolean(pageId && s.loading[pageId]));
  const error = useServerPageHistoryStore((s) => (pageId ? s.error[pageId] ?? null : null));
  const fetchPageHistory = useServerPageHistoryStore((s) => s.fetchPageHistory);
  const restorePageHistoryEvent = useServerPageHistoryStore((s) => s.restorePageHistoryEvent);
  const savePageVersion = useServerPageHistoryStore((s) => s.savePageVersion);
  const deletePageHistoryEvents = useServerPageHistoryStore((s) => s.deletePageHistoryEvents);
  const [savingVersion, setSavingVersion] = useState(false);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  // "편집 중" 배지 판정 기준 시각 — 렌더 중 Date.now() 호출 금지(react-hooks/purity)라 effect 로 고정.
  const [nowTs, setNowTs] = useState(0);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ label: string; eventIds: string[] } | null>(null);

  useEffect(() => {
    if (!open || !pageId || !workspaceId) return;
    setNowTs(Date.now());
    void fetchPageHistory(pageId, workspaceId);
  }, [fetchPageHistory, open, pageId, workspaceId]);

  const timelineIds = useMemo(
    () => pageHistoryTimeline.map((entry) => entry.id),
    [pageHistoryTimeline],
  );
  const timelineKey = timelineIds.join("|");
  useEffect(() => {
    if (!open) return;
    setSelectedHistoryId((prev) => {
      if (prev && timelineIds.includes(prev)) return prev;
      return timelineIds[0] ?? null;
    });
  }, [open, timelineIds, timelineKey]);

  const {
    selectedIds: selectedTimelineIds,
    toggleOne: toggleTimelineOne,
    toggleAll: toggleTimelineAll,
    clearSelection: clearTimelineSelection,
  } = useHistorySelection(timelineIds);
  const selectedEntries = useMemo(
    () => pageHistoryTimeline.filter((entry) => selectedTimelineIds.has(entry.id)),
    [pageHistoryTimeline, selectedTimelineIds],
  );
  const selectedEventIds = useMemo(
    () => selectedEntries.flatMap((entry) => entry.eventIds),
    [selectedEntries],
  );

  const pages = usePageStore((s) => s.pages);
  const databases = useDatabaseStore((s) => s.databases);

  const snapshotMap = useMemo(
    () => (pageId && workspaceId ? buildPageHistorySnapshotMap(historyEntries, pageId, workspaceId) : new Map()),
    [historyEntries, pageId, workspaceId],
  );
  const selectedAfter = selectedHistoryId ? snapshotMap.get(selectedHistoryId) ?? null : null;
  // 이전 스냅샷은 이미 만든 snapshotMap 에서 조회한다(과거엔 getPreviousPageHistorySnapshot 이
  // 매 렌더마다 스냅샷 맵을 통째로 다시 빌드해 심한 렉을 유발했다).
  const selectedBefore = useMemo(() => {
    if (!selectedHistoryId || !workspaceId) return null;
    const sorted = [...historyEntries]
      .filter((e) => e.workspaceId === workspaceId)
      .sort(
        (a, b) =>
          (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0) ||
          a.historyId.localeCompare(b.historyId),
      );
    const idx = sorted.findIndex((e) => e.historyId === selectedHistoryId);
    if (idx <= 0) return null;
    const prevId = sorted[idx - 1]?.historyId;
    return prevId ? snapshotMap.get(prevId) ?? null : null;
  }, [historyEntries, snapshotMap, selectedHistoryId, workspaceId]);

  const previewContext = useMemo(() => {
    const dbId = selectedAfter?.databaseId ?? selectedBefore?.databaseId;
    const bundle = dbId ? databases[dbId] : null;
    const columns = bundle?.columns ?? [];
    const colMap = new Map(columns.map((c) => [c.id, c]));
    return {
      getDatabaseTitle: (id: string) => databases[id]?.meta.title ?? null,
      getPageTitle: (id: string) => pages[id]?.title ?? null,
      getColumnName: (columnId: string) => colMap.get(columnId)?.name ?? null,
      getOptionLabel: (columnId: string, optionId: string) => {
        const col = colMap.get(columnId);
        return col?.config?.options?.find((o) => o.id === optionId)?.label ?? null;
      },
    };
  }, [databases, pages, selectedAfter, selectedBefore]);

  // 통합 뷰: 변경분만이 아니라 선택 버전의 "전체 속성"을 변경 상태와 함께 보여준다.
  const propertyRows = useMemo(
    () => buildPagePropertyRows(selectedBefore, selectedAfter, previewContext),
    [selectedAfter, selectedBefore, previewContext],
  );
  // 세션 엔트리 메타(changedUnits 요약·참여자·편집 중 배지)용 원본 엔트리 조회 맵.
  const rawEntryById = useMemo(
    () => new Map(historyEntries.map((entry) => [entry.historyId, entry])),
    [historyEntries],
  );

  // "편집 중" 배지는 단일 head(현재 작업 버전)에만 표시한다 — 복원/편집마다 새 head 가 생겨도
  // 배지는 1개로 그 head 로 옮겨간다. 과거엔 "10분 내 page.session 이면 전부" 표시라, 복원+편집을
  // 반복하면 옛 세션들이 계속 배지를 달아 "편집중"이 2개·3개로 누적되는 버그가 있었다.
  // 복원 시 서버가 page.restoreVersion 을 새 head 로 남기므로, 그 head 도 "현재 작업 버전"으로 본다.
  const liveHeadId = useMemo(() => {
    if (nowTs <= 0) return null;
    let head: (typeof pageHistoryTimeline)[number] | null = null;
    for (const e of pageHistoryTimeline) if (!head || e.endTs > head.endTs) head = e;
    if (!head) return null;
    const raw = rawEntryById.get(head.id);
    if (raw?.kind !== "page.session" && raw?.kind !== "page.restoreVersion") return null;
    const last = Date.parse(raw.lastActivityAt ?? raw.createdAt ?? "") || head.endTs;
    return nowTs - last < 10 * 60_000 ? head.id : null;
  }, [pageHistoryTimeline, rawEntryById, nowTs]);

  // 리스트에 "무엇이 바뀌었나" 요약 — 컬럼명 해석용 ctx 는 페이지의 databaseId 기준.
  const listCtx = useMemo(() => {
    let dbId = pageId ? pages[pageId]?.databaseId ?? null : null;
    if (!dbId) {
      for (const snap of snapshotMap.values()) {
        if (snap?.databaseId) {
          dbId = snap.databaseId;
          break;
        }
      }
    }
    const colMap = new Map((dbId ? databases[dbId]?.columns ?? [] : []).map((c) => [c.id, c]));
    return {
      getDatabaseTitle: (id: string) => databases[id]?.meta.title ?? null,
      getPageTitle: (id: string) => pages[id]?.title ?? null,
      getColumnName: (columnId: string) => colMap.get(columnId)?.name ?? null,
      getOptionLabel: (columnId: string, optionId: string) =>
        colMap.get(columnId)?.config?.options?.find((o) => o.id === optionId)?.label ?? null,
    };
  }, [databases, pages, pageId, snapshotMap]);

  const pageSummaries = useMemo(() => {
    const map = new Map<string, string>();
    if (!pageId || !workspaceId) return map;
    const asc = [...historyEntries]
      .filter((e) => e.workspaceId === workspaceId)
      .sort(
        (a, b) =>
          (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0) ||
          a.historyId.localeCompare(b.historyId),
      );
    let prev: ReturnType<typeof snapshotMap.get> | null = null;
    for (const e of asc) {
      const cur = snapshotMap.get(e.historyId) ?? null;
      // 첫 버전(이전 스냅샷 없음)은 요약 대신 항목 라벨("페이지 생성")로 폴백.
      const summary = prev === null ? "" : summarizePreviewChanges(buildPagePreviewChanges(prev, cur, listCtx));
      map.set(e.historyId, summary);
      if (cur) prev = cur;
    }
    return map;
  }, [historyEntries, snapshotMap, listCtx, pageId, workspaceId]);
  const confirmZIndex = isInsidePeek ? 730 : 500;

  if (!open || !pageId || !workspaceId) return null;
  const canRestore = Boolean(selectedHistoryId && selectedAfter);

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
          aria-labelledby="qn-page-history-title"
          className="flex h-[86vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <h2 id="qn-page-history-title" className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              페이지 버전 히스토리
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
              ) : !selectedHistoryId ? (
                <div className="text-sm text-zinc-500">버전 기록이 없습니다.</div>
              ) : (
                <div className="space-y-4">
                  {propertyRows.length > 0 ? (
                    <div className="rounded-md border border-zinc-200 dark:border-zinc-800">
                      <div className="border-b border-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-500 dark:border-zinc-800">
                        속성
                      </div>
                      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {propertyRows.map((row) => (
                          <div key={row.id} className="flex gap-3 px-3 py-1.5 text-sm">
                            <span className="w-28 shrink-0 truncate text-zinc-500">{row.label}</span>
                            <span className="min-w-0 flex-1 break-words">
                              {row.status === "unchanged" ? (
                                <span className="text-zinc-700 dark:text-zinc-200">{row.after}</span>
                              ) : row.status === "added" ? (
                                <span className="rounded bg-emerald-200/70 px-1 text-emerald-800 dark:bg-emerald-800/40 dark:text-emerald-200">
                                  {row.after}
                                </span>
                              ) : row.status === "removed" ? (
                                <span className="rounded bg-red-200/70 px-1 text-red-800 line-through dark:bg-red-800/40 dark:text-red-200">
                                  {row.before}
                                </span>
                              ) : (
                                <span className="inline-flex flex-wrap items-center gap-1">
                                  <span className="rounded bg-red-200/70 px-1 text-red-800 line-through dark:bg-red-800/40 dark:text-red-200">
                                    {row.before}
                                  </span>
                                  <span className="text-zinc-400">→</span>
                                  <span className="rounded bg-emerald-200/70 px-1 text-emerald-800 dark:bg-emerald-800/40 dark:text-emerald-200">
                                    {row.after}
                                  </span>
                                </span>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div>
                    <div className="mb-1 px-1 text-xs font-medium text-zinc-500">본문</div>
                    <UnifiedBlockDiffView beforeDoc={selectedBefore?.doc} afterDoc={selectedAfter?.doc} />
                  </div>
                </div>
              )}
            </div>

            <div className="flex min-h-0 flex-col border-l border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center justify-between gap-2 border-b border-zinc-200 p-3 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => toggleTimelineAll()}
                  className="inline-flex items-center gap-1 rounded border border-zinc-200 px-2 py-1 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  {selectedTimelineIds.size > 0 && selectedTimelineIds.size === timelineIds.length ? (
                    <Check size={12} />
                  ) : selectedTimelineIds.size > 0 ? (
                    <Minus size={12} />
                  ) : (
                    <span className="inline-block h-3 w-3 rounded-sm border border-zinc-400" />
                  )}
                  전체 선택
                </button>
                <button
                  type="button"
                  disabled={savingVersion || !pageId || !workspaceId}
                  onClick={() => {
                    if (!pageId || !workspaceId) return;
                    setSavingVersion(true);
                    void savePageVersion(pageId, workspaceId).finally(() => setSavingVersion(false));
                  }}
                  className="inline-flex items-center gap-1 rounded border border-blue-200 px-2 py-1 text-sm text-blue-600 hover:bg-blue-50 disabled:cursor-progress disabled:opacity-60 dark:border-blue-900/40 dark:text-blue-300 dark:hover:bg-blue-950/30"
                  title="현재 상태를 하나의 버전으로 즉시 저장합니다."
                >
                  {savingVersion ? "저장 중…" : "현재 버전 저장"}
                </button>
                {selectedTimelineIds.size > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteTarget({
                        label: `${selectedTimelineIds.size}개 선택 항목`,
                        eventIds: selectedEventIds,
                      });
                      setDeleteConfirmOpen(true);
                    }}
                    className="rounded border border-red-200 px-2 py-1 text-sm text-red-600 hover:bg-red-50 dark:border-red-900/40 dark:hover:bg-red-950/30"
                  >
                    선택 삭제
                  </button>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {pageHistoryTimeline.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-zinc-500">버전 기록이 없습니다.</div>
                ) : (
                  pageHistoryTimeline.slice(0, 100).map((entry) => {
                    const active = selectedHistoryId === entry.id;
                    const raw = rawEntryById.get(entry.id);
                    // 세션 엔트리는 서버가 미리 계산한 changedUnits 요약을 우선 사용한다.
                    const summary =
                      summarizeChangedUnits(raw?.changedUnits) ||
                      pageSummaries.get(entry.id) ||
                      entry.label;
                    const contributors = parseContributors(raw?.contributors);
                    const editorSuffix =
                      contributors.length > 1 ? ` 외 ${contributors.length - 1}명` : "";
                    // "편집 중"은 단일 head(현재 작업 버전)에만 — liveHeadId 참고.
                    const isLiveSession = entry.id === liveHeadId;
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
                          aria-checked={selectedTimelineIds.has(entry.id)}
                          tabIndex={-1}
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
                        >
                          {selectedTimelineIds.has(entry.id) ? <Check size={10} strokeWidth={3} /> : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            className={[
                              "block truncate",
                              entry.representativeKind === "page.delete"
                                ? "text-red-600 dark:text-red-400"
                                : entry.representativeKind === "page.create"
                                  ? "text-blue-600 dark:text-blue-400"
                                  : "text-zinc-700 dark:text-zinc-200",
                            ].join(" ")}
                          >
                            {summary}
                          </span>
                          <span className="block truncate text-xs text-zinc-400">
                            {formatPageHistoryEditorLine(entry, { members, me })}
                            {editorSuffix}
                          </span>
                        </span>
                        {isLiveSession ? (
                          <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:bg-blue-950/40 dark:text-blue-300">
                            편집 중
                          </span>
                        ) : null}
                        <span className="shrink-0 text-xs text-zinc-400">
                          {new Date(entry.endTs).toLocaleString()}
                        </span>
                        <span
                          role="button"
                          tabIndex={-1}
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTarget({ label: summary, eventIds: entry.eventIds });
                            setDeleteConfirmOpen(true);
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
              <div className="flex justify-end border-t border-zinc-200 p-3 dark:border-zinc-800">
                <button
                  type="button"
                  disabled={!canRestore}
                  onClick={() => {
                    if (!selectedHistoryId) return;
                    void restorePageHistoryEvent(pageId, workspaceId, selectedHistoryId).then(() => onClose());
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
        open={deleteConfirmOpen}
        title="히스토리 항목 삭제"
        message={`"${deleteTarget?.label ?? "선택한 항목"}" 히스토리를 삭제할까요?`}
        confirmLabel="삭제"
        danger
        zIndex={confirmZIndex}
        onCancel={() => {
          setDeleteConfirmOpen(false);
          setDeleteTarget(null);
        }}
        onConfirm={() => {
          if (deleteTarget) void deletePageHistoryEvents(pageId, workspaceId, deleteTarget.eventIds);
          setDeleteConfirmOpen(false);
          setDeleteTarget(null);
          clearTimelineSelection();
        }}
      />
    </>,
    document.body,
  );
}
