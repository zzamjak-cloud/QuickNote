import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { newId } from "../lib/id";
import { zustandStorage } from "../lib/storage/index";
import type {
  DatabaseSnapshot,
  DbHistoryEvent,
  DbHistoryKind,
  DeletedRowTombstone,
  HistoryTimelineEntry,
  PageHistoryEvent,
  PageHistoryKind,
  PageSnapshot,
} from "../types/history";
import {
  HISTORY_ANCHOR_INTERVAL,
  HISTORY_GROUP_WINDOW_MS,
  HISTORY_RETENTION_MAX_AGE_MS,
  HISTORY_RETENTION_MAX_EVENTS,
  HISTORY_STORE_VERSION,
} from "../types/history";
import { useMemberStore } from "./memberStore";
import { useWorkspaceStore } from "./workspaceStore";

/** 히스토리 이벤트에 붙일 현재 편집자(맴버 스토어 기준) */
function getPageEventEditorFields(): Pick<
  PageHistoryEvent,
  "editedByMemberId" | "editedByName"
> {
  const me = useMemberStore.getState().me;
  if (!me) return {};
  return { editedByMemberId: me.memberId, editedByName: me.name };
}

function getCurrentWorkspaceId(): string | null {
  return useWorkspaceStore.getState().currentWorkspaceId ?? null;
}

function filterCurrentWorkspaceEvents<T extends { workspaceId?: string | null }>(
  events: T[],
): T[] {
  const current = getCurrentWorkspaceId();
  if (!current) return events;
  const cacheWs = useHistoryStore.getState().cacheWorkspaceId;
  return events.filter((event) => {
    const wid = event.workspaceId;
    if (wid == null || wid === "") return true;
    if (wid === current) return true;
    if (cacheWs != null && cacheWs !== "" && wid === cacheWs) return true;
    return false;
  });
}

type HistoryState = {
  pageEventsByPageId: Record<string, PageHistoryEvent[]>;
  dbEventsByDatabaseId: Record<string, DbHistoryEvent[]>;
  deletedRowTombstonesByDbId: Record<string, DeletedRowTombstone[]>;
  cacheWorkspaceId: string | null;
};

type HistoryActions = {
  recordPageEvent: (
    pageId: string,
    kind: PageHistoryKind,
    patch: Partial<PageSnapshot>,
    anchor?: PageSnapshot,
  ) => void;
  recordDbEvent: (
    databaseId: string,
    kind: DbHistoryKind,
    patch: Partial<DatabaseSnapshot>,
    anchor?: DatabaseSnapshot,
  ) => void;
  recordDeletedRowTombstone: (row: Omit<DeletedRowTombstone, "id" | "ts">) => void;
  getLatestPageSnapshot: (pageId: string) => PageSnapshot | null;
  getLatestDbSnapshot: (databaseId: string) => DatabaseSnapshot | null;
  getPageEvents: (pageId: string) => PageHistoryEvent[];
  getDbEvents: (databaseId: string) => DbHistoryEvent[];
  getPageTimeline: (pageId: string) => HistoryTimelineEntry[];
  getDbTimeline: (databaseId: string) => HistoryTimelineEntry[];
  deletePageHistoryEvents: (pageId: string, eventIds: string[]) => void;
  deleteDbHistoryEvents: (databaseId: string, eventIds: string[]) => void;
  getPageSnapshotAtEvent: (pageId: string, eventId: string) => PageSnapshot | null;
  getDbSnapshotAtEvent: (databaseId: string, eventId: string) => DatabaseSnapshot | null;
  getDeletedRowTombstones: (databaseId: string) => DeletedRowTombstone[];
  popDeletedRowTombstone: (databaseId: string, tombstoneId: string) => DeletedRowTombstone | null;
  getDeletedDbRestorePoints: () => Array<{
    databaseId: string;
    eventId: string;
    ts: number;
    title: string;
  }>;
};

export type HistoryStore = HistoryState & HistoryActions;

function trimEventsByRetention<T extends { ts: number }>(events: T[]): T[] {
  const threshold = Date.now() - HISTORY_RETENTION_MAX_AGE_MS;
  const ageFiltered = events.filter((e) => e.ts >= threshold);
  if (ageFiltered.length <= HISTORY_RETENTION_MAX_EVENTS) return ageFiltered;
  return ageFiltered.slice(ageFiltered.length - HISTORY_RETENTION_MAX_EVENTS);
}

/**
 * DB 이벤트 보존 정책 — 가장 오래된 항목부터 자르면 db.create 가 먼저 사라져
 * mergeDbPatch(null, …) 가 실패하고 getDbTimeline 이 전부 필터링되는 문제가 생긴다.
 */
export function trimDbEventsByRetention(events: DbHistoryEvent[]): DbHistoryEvent[] {
  if (events.length === 0) return events;
  const asc = [...events].sort((a, b) => a.ts - b.ts);
  const firstCreate = asc.find((e) => e.kind === "db.create");
  const threshold = Date.now() - HISTORY_RETENTION_MAX_AGE_MS;
  const max = HISTORY_RETENTION_MAX_EVENTS;

  const ageFiltered = asc.filter((e) => {
    if (firstCreate && e.id === firstCreate.id) return true;
    return e.ts >= threshold;
  });

  if (ageFiltered.length <= max) {
    return ageFiltered.sort((a, b) => a.ts - b.ts);
  }

  const pinned = firstCreate ? ageFiltered.filter((e) => e.id === firstCreate.id) : [];
  const pinnedId = firstCreate?.id;
  const movable = ageFiltered.filter((e) => e.id !== pinnedId);
  const budget = Math.max(0, max - pinned.length);
  const keptMovable =
    budget === 0 ? [] : movable.slice(Math.max(0, movable.length - budget));
  return [...pinned, ...keptMovable].sort((a, b) => a.ts - b.ts);
}

function mergePagePatch(
  base: PageSnapshot | null,
  patch: Partial<PageSnapshot>,
): PageSnapshot | null {
  if (!base && !patch.id) return null;
  if (!base && patch.id) {
    return {
      id: patch.id,
      title: patch.title ?? "제목 없음",
      icon: patch.icon ?? null,
      doc: patch.doc ?? { type: "doc", content: [{ type: "paragraph" }] },
      parentId: patch.parentId ?? null,
      order: patch.order ?? 0,
      databaseId: patch.databaseId,
      dbCells: patch.dbCells,
    };
  }
  if (!base) return null;
  return { ...base, ...patch };
}

function mergeDbPatch(
  base: DatabaseSnapshot | null,
  patch: Partial<DatabaseSnapshot>,
): DatabaseSnapshot | null {
  if (!base) {
    // 첫 이벤트(db.create)는 anchor 없이도 전체 스냅샷 patch가 올 수 있다.
    // 이 경우 초기 스냅샷으로 승격해 타임라인/복원이 가능해야 한다.
    if (
      patch.meta &&
      typeof patch.meta.id === "string" &&
      Array.isArray(patch.columns) &&
      Array.isArray(patch.rowPageOrder)
    ) {
      return structuredClone(patch as DatabaseSnapshot);
    }
    return null;
  }
  return { ...base, ...patch };
}

function isValidDatabaseSnapshot(snapshot: DatabaseSnapshot | null): snapshot is DatabaseSnapshot {
  if (!snapshot) return false;
  if (!snapshot.meta || typeof snapshot.meta.id !== "string") return false;
  if (!Array.isArray(snapshot.columns)) return false;
  if (!Array.isArray(snapshot.rowPageOrder)) return false;
  return true;
}

function shouldCoalescePageEvent(kind: PageHistoryKind): boolean {
  // 타이핑 중 연속 발생하는 이벤트는 마지막 상태만 남긴다.
  return kind === "page.rename";
}

function shouldCoalesceDbEvent(kind: DbHistoryKind): boolean {
  // DB 이름 입력도 타이핑 중에는 마지막 상태만 남긴다.
  return kind === "db.title";
}

function dbKindLabel(kind: DbHistoryKind): string {
  switch (kind) {
    case "db.cell":
      return "셀 값 수정";
    case "db.row.add":
      return "행 추가";
    case "db.row.delete":
      return "행 삭제";
    case "db.row.order":
      return "행 순서 변경";
    case "db.column.add":
      return "컬럼 추가";
    case "db.column.update":
      return "컬럼 수정";
    case "db.column.remove":
      return "컬럼 삭제";
    case "db.column.move":
      return "컬럼 순서 변경";
    case "db.title":
      return "데이터베이스 이름 변경";
    case "db.create":
      return "데이터베이스 생성";
    case "db.delete":
      return "데이터베이스 삭제";
    default:
      return kind;
  }
}

function dbBucket(kind: DbHistoryKind): "content" | "structure" {
  if (kind === "db.cell") return "content";
  return "structure";
}

function groupTimeline<T extends { id: string; ts: number; kind: string }>(
  ascEvents: T[],
  getBucket: (kind: T["kind"]) => "content" | "structure",
  getLabel: (kind: T["kind"]) => string,
): HistoryTimelineEntry[] {
  if (ascEvents.length === 0) return [];
  const grouped: HistoryTimelineEntry[] = [];
  for (const ev of ascEvents) {
    const bucket = getBucket(ev.kind);
    const prev = grouped[grouped.length - 1];
    const canMerge =
      prev &&
      prev.bucket === bucket &&
      ev.ts - prev.endTs <= HISTORY_GROUP_WINDOW_MS &&
      bucket === "content";
    if (canMerge) {
      prev.eventIds.push(ev.id);
      prev.endTs = ev.ts;
      prev.count += 1;
      continue;
    }
    grouped.push({
      id: ev.id,
      bucket,
      representativeKind: ev.kind as HistoryTimelineEntry["representativeKind"],
      eventIds: [ev.id],
      startTs: ev.ts,
      endTs: ev.ts,
      count: 1,
      label: getLabel(ev.kind),
    });
  }
  return grouped
    .map((g) => ({
      ...g,
      label:
        g.bucket === "content" && g.count > 1
          ? `${g.label} (${g.count}회)`
          : g.label,
    }))
    .sort((a, b) => b.endTs - a.endTs);
}

function groupPageTimeline(ascEvents: PageHistoryEvent[]): HistoryTimelineEntry[] {
  if (ascEvents.length === 0) return [];
  const grouped: HistoryTimelineEntry[] = [];
  for (const ev of ascEvents) {
    const prev = grouped[grouped.length - 1];
    const canMerge = prev && ev.ts - prev.endTs <= HISTORY_GROUP_WINDOW_MS;
    if (canMerge) {
      prev.eventIds.push(ev.id);
      prev.endTs = ev.ts;
      prev.count += 1;
      prev.lastEditedByMemberId = ev.editedByMemberId ?? prev.lastEditedByMemberId;
      prev.lastEditedByName = ev.editedByName ?? prev.lastEditedByName;
      continue;
    }
    grouped.push({
      id: ev.id,
      bucket: "content",
      representativeKind: ev.kind,
      eventIds: [ev.id],
      startTs: ev.ts,
      endTs: ev.ts,
      count: 1,
      label: "페이지 변경",
      lastEditedByMemberId: ev.editedByMemberId,
      lastEditedByName: ev.editedByName,
    });
  }
  return grouped
    .map((g) => ({
      ...g,
      label: g.count > 1 ? `페이지 변경 (${g.count}회)` : "페이지 변경",
    }))
    .sort((a, b) => b.endTs - a.endTs);
}

export const useHistoryStore = create<HistoryStore>()(
  persist(
    (set, get) => ({
      pageEventsByPageId: {},
      dbEventsByDatabaseId: {},
      deletedRowTombstonesByDbId: {},
      cacheWorkspaceId: null,

      recordPageEvent: (pageId, kind, patch, anchor) => {
        set((state) => {
          const editor = getPageEventEditorFields();
          const workspaceId = getCurrentWorkspaceId();
          const prev = state.pageEventsByPageId[pageId] ?? [];
          const last = prev[prev.length - 1];
          if (
            last &&
            last.kind === kind &&
            shouldCoalescePageEvent(kind)
          ) {
            const merged: PageHistoryEvent = {
              ...last,
              workspaceId,
              ts: Date.now(),
              patch: { ...last.patch, ...patch },
              // coalesce 중에는 anchor를 새로 늘리지 않고 기존 anchor를 유지한다.
              anchor: last.anchor,
              ...editor,
            };
            const next = trimEventsByRetention([
              ...prev.slice(0, -1),
              merged,
            ]);
            return {
              pageEventsByPageId: { ...state.pageEventsByPageId, [pageId]: next },
              cacheWorkspaceId: workspaceId ?? state.cacheWorkspaceId,
            };
          }
          const nextEvent: PageHistoryEvent = {
            id: newId(),
            ts: Date.now(),
            kind,
            pageId,
            workspaceId,
            patch,
            anchor,
            ...editor,
          };
          const next = trimEventsByRetention([...prev, nextEvent]);
          return {
            pageEventsByPageId: { ...state.pageEventsByPageId, [pageId]: next },
            cacheWorkspaceId: workspaceId ?? state.cacheWorkspaceId,
          };
        });
      },

      recordDbEvent: (databaseId, kind, patch, anchor) => {
        set((state) => {
          const workspaceId = getCurrentWorkspaceId();
          const prev = state.dbEventsByDatabaseId[databaseId] ?? [];
          const last = prev[prev.length - 1];
          if (last && last.kind === kind && shouldCoalesceDbEvent(kind)) {
            const merged: DbHistoryEvent = {
              ...last,
              workspaceId,
              ts: Date.now(),
              patch: { ...last.patch, ...patch },
              anchor: last.anchor,
            };
            const next = trimDbEventsByRetention([
              ...prev.slice(0, -1),
              merged,
            ]);
            return {
              dbEventsByDatabaseId: {
                ...state.dbEventsByDatabaseId,
                [databaseId]: next,
              },
              cacheWorkspaceId: workspaceId ?? state.cacheWorkspaceId,
            };
          }
          const nextEvent: DbHistoryEvent = {
            id: newId(),
            ts: Date.now(),
            kind,
            databaseId,
            workspaceId,
            patch,
            anchor,
          };
          const next = trimDbEventsByRetention([...prev, nextEvent]);
          return {
            dbEventsByDatabaseId: { ...state.dbEventsByDatabaseId, [databaseId]: next },
            cacheWorkspaceId: workspaceId ?? state.cacheWorkspaceId,
          };
        });
      },

      recordDeletedRowTombstone: (row) => {
        set((state) => {
          const workspaceId = getCurrentWorkspaceId();
          const prev = state.deletedRowTombstonesByDbId[row.databaseId] ?? [];
          const next = trimEventsByRetention([
            ...prev,
            { ...row, workspaceId, id: newId(), ts: Date.now() },
          ]);
          return {
            deletedRowTombstonesByDbId: {
              ...state.deletedRowTombstonesByDbId,
              [row.databaseId]: next,
            },
            cacheWorkspaceId: workspaceId ?? state.cacheWorkspaceId,
          };
        });
      },

      getLatestPageSnapshot: (pageId) => {
        const events = filterCurrentWorkspaceEvents(
          get().pageEventsByPageId[pageId] ?? [],
        );
        if (events.length === 0) return null;
        let snapshot: PageSnapshot | null = null;
        for (const event of events) {
          if (event.anchor) snapshot = structuredClone(event.anchor);
          snapshot = mergePagePatch(snapshot, event.patch);
        }
        return snapshot;
      },

      getLatestDbSnapshot: (databaseId) => {
        const events = filterCurrentWorkspaceEvents(
          get().dbEventsByDatabaseId[databaseId] ?? [],
        )
          .slice()
          .sort((a, b) => a.ts - b.ts);
        if (events.length === 0) return null;
        let snapshot: DatabaseSnapshot | null = null;
        for (const event of events) {
          if (event.anchor) snapshot = structuredClone(event.anchor);
          snapshot = mergeDbPatch(snapshot, event.patch);
        }
        return isValidDatabaseSnapshot(snapshot) ? snapshot : null;
      },

      getPageEvents: (pageId) =>
        filterCurrentWorkspaceEvents([...(get().pageEventsByPageId[pageId] ?? [])])
          .sort((a, b) => b.ts - a.ts),

      getDbEvents: (databaseId) =>
        filterCurrentWorkspaceEvents([
          ...(get().dbEventsByDatabaseId[databaseId] ?? []),
        ]).sort((a, b) => b.ts - a.ts),

      getPageTimeline: (pageId) =>
        groupPageTimeline(
          filterCurrentWorkspaceEvents([
            ...(get().pageEventsByPageId[pageId] ?? []),
          ]).sort((a, b) => a.ts - b.ts),
        ),

      getDbTimeline: (databaseId) =>
        groupTimeline(
          filterCurrentWorkspaceEvents([
            ...(get().dbEventsByDatabaseId[databaseId] ?? []),
          ]).sort((a, b) => a.ts - b.ts),
          dbBucket,
          dbKindLabel,
        ).filter((entry) => {
          const targetEventId = entry.eventIds[entry.eventIds.length - 1];
          if (!targetEventId) return false;
          return isValidDatabaseSnapshot(
            get().getDbSnapshotAtEvent(databaseId, targetEventId),
          );
        }),

      deletePageHistoryEvents: (pageId, eventIds) => {
        if (eventIds.length === 0) return;
        const idSet = new Set(eventIds);
        set((state) => {
          const prev = state.pageEventsByPageId[pageId] ?? [];
          const next = prev.filter((ev) => !idSet.has(ev.id));
          return {
            pageEventsByPageId: { ...state.pageEventsByPageId, [pageId]: next },
          };
        });
      },

      deleteDbHistoryEvents: (databaseId, eventIds) => {
        if (eventIds.length === 0) return;
        const idSet = new Set(eventIds);
        set((state) => {
          const prev = state.dbEventsByDatabaseId[databaseId] ?? [];
          const next = prev.filter((ev) => !idSet.has(ev.id));
          return {
            dbEventsByDatabaseId: {
              ...state.dbEventsByDatabaseId,
              [databaseId]: next,
            },
          };
        });
      },

      getPageSnapshotAtEvent: (pageId, eventId) => {
        const events = filterCurrentWorkspaceEvents(
          get().pageEventsByPageId[pageId] ?? [],
        );
        if (events.length === 0) return null;
        let snapshot: PageSnapshot | null = null;
        for (const event of events) {
          if (event.anchor) snapshot = structuredClone(event.anchor);
          snapshot = mergePagePatch(snapshot, event.patch);
          if (event.id === eventId) return snapshot;
        }
        return null;
      },

      getDbSnapshotAtEvent: (databaseId, eventId) => {
        const events = filterCurrentWorkspaceEvents(
          get().dbEventsByDatabaseId[databaseId] ?? [],
        )
          .slice()
          .sort((a, b) => a.ts - b.ts);
        if (events.length === 0) return null;
        let snapshot: DatabaseSnapshot | null = null;
        for (const event of events) {
          if (event.anchor) snapshot = structuredClone(event.anchor);
          snapshot = mergeDbPatch(snapshot, event.patch);
          if (event.id === eventId) {
            return isValidDatabaseSnapshot(snapshot) ? snapshot : null;
          }
        }
        return null;
      },

      getDeletedRowTombstones: (databaseId) =>
        filterCurrentWorkspaceEvents([
          ...(get().deletedRowTombstonesByDbId[databaseId] ?? []),
        ]).sort((a, b) => b.ts - a.ts),

      popDeletedRowTombstone: (databaseId, tombstoneId) => {
        let removed: DeletedRowTombstone | null = null;
        set((state) => {
          const list = filterCurrentWorkspaceEvents(
            state.deletedRowTombstonesByDbId[databaseId] ?? [],
          );
          const next = list.filter((t) => {
            if (t.id === tombstoneId) {
              removed = t;
              return false;
            }
            return true;
          });
          return {
            deletedRowTombstonesByDbId: {
              ...state.deletedRowTombstonesByDbId,
              [databaseId]: next,
            },
          };
        });
        return removed;
      },
      getDeletedDbRestorePoints: () => {
        const out: Array<{
          databaseId: string;
          eventId: string;
          ts: number;
          title: string;
        }> = [];
        for (const [databaseId, eventsRaw] of Object.entries(get().dbEventsByDatabaseId)) {
          const events = filterCurrentWorkspaceEvents(eventsRaw);
          if (!events.length) continue;
          const sorted = [...events].sort((a, b) => a.ts - b.ts);
          const lastDelete = [...sorted].reverse().find((e) => e.kind === "db.delete");
          if (!lastDelete) continue;
          const title = lastDelete.patch.meta?.title ?? "삭제된 데이터베이스";
          out.push({
            databaseId,
            eventId: lastDelete.id,
            ts: lastDelete.ts,
            title,
          });
        }
        return out.sort((a, b) => b.ts - a.ts);
      },
    }),
    {
      name: "quicknote.historyStore.v1",
      storage: createJSONStorage(() => zustandStorage),
      version: HISTORY_STORE_VERSION,
      migrate: (persisted) => ({
        ...(persisted && typeof persisted === "object" ? persisted : {}),
        cacheWorkspaceId: null,
      }),
    },
  ),
);

/**
 * db.create 없이 패치만 쌓이면 getDbTimeline 이 전부 탈락한다.
 * 로컬·원격 적용 순서로 생긴 고아 체인은 삭제 후 현재 bundle 기준으로 재시드한다.
 */
export function repairDbHistoryBaselineIfNeeded(
  databaseId: string,
  bundle: DatabaseSnapshot,
): void {
  const hs = useHistoryStore.getState();
  const raw = hs.dbEventsByDatabaseId[databaseId] ?? [];
  if (raw.some((e) => e.kind === "db.create")) return;
  if (raw.length > 0) {
    hs.deleteDbHistoryEvents(
      databaseId,
      raw.map((e) => e.id),
    );
  }
  const snap = structuredClone(bundle);
  hs.recordDbEvent(databaseId, "db.create", snap, snap);
}

export function shouldWriteAnchor(eventCount: number): boolean {
  return eventCount % HISTORY_ANCHOR_INTERVAL === 0;
}
