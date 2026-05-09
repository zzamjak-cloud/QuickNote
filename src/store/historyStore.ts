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

/** 히스토리 이벤트에 붙일 현재 편집자(맴버 스토어 기준) */
function getPageEventEditorFields(): Pick<
  PageHistoryEvent,
  "editedByMemberId" | "editedByName"
> {
  const me = useMemberStore.getState().me;
  if (!me) return {};
  return { editedByMemberId: me.memberId, editedByName: me.name };
}

type HistoryState = {
  pageEventsByPageId: Record<string, PageHistoryEvent[]>;
  dbEventsByDatabaseId: Record<string, DbHistoryEvent[]>;
  deletedRowTombstonesByDbId: Record<string, DeletedRowTombstone[]>;
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

      recordPageEvent: (pageId, kind, patch, anchor) => {
        set((state) => {
          const editor = getPageEventEditorFields();
          const prev = state.pageEventsByPageId[pageId] ?? [];
          const last = prev[prev.length - 1];
          if (
            last &&
            last.kind === kind &&
            shouldCoalescePageEvent(kind)
          ) {
            const merged: PageHistoryEvent = {
              ...last,
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
            };
          }
          const nextEvent: PageHistoryEvent = {
            id: newId(),
            ts: Date.now(),
            kind,
            pageId,
            patch,
            anchor,
            ...editor,
          };
          const next = trimEventsByRetention([...prev, nextEvent]);
          return {
            pageEventsByPageId: { ...state.pageEventsByPageId, [pageId]: next },
          };
        });
      },

      recordDbEvent: (databaseId, kind, patch, anchor) => {
        set((state) => {
          const prev = state.dbEventsByDatabaseId[databaseId] ?? [];
          const last = prev[prev.length - 1];
          if (last && last.kind === kind && shouldCoalesceDbEvent(kind)) {
            const merged: DbHistoryEvent = {
              ...last,
              ts: Date.now(),
              patch: { ...last.patch, ...patch },
              anchor: last.anchor,
            };
            const next = trimEventsByRetention([
              ...prev.slice(0, -1),
              merged,
            ]);
            return {
              dbEventsByDatabaseId: {
                ...state.dbEventsByDatabaseId,
                [databaseId]: next,
              },
            };
          }
          const nextEvent: DbHistoryEvent = {
            id: newId(),
            ts: Date.now(),
            kind,
            databaseId,
            patch,
            anchor,
          };
          const next = trimEventsByRetention([...prev, nextEvent]);
          return {
            dbEventsByDatabaseId: { ...state.dbEventsByDatabaseId, [databaseId]: next },
          };
        });
      },

      recordDeletedRowTombstone: (row) => {
        set((state) => {
          const prev = state.deletedRowTombstonesByDbId[row.databaseId] ?? [];
          const next = trimEventsByRetention([
            ...prev,
            { ...row, id: newId(), ts: Date.now() },
          ]);
          return {
            deletedRowTombstonesByDbId: {
              ...state.deletedRowTombstonesByDbId,
              [row.databaseId]: next,
            },
          };
        });
      },

      getLatestPageSnapshot: (pageId) => {
        const events = get().pageEventsByPageId[pageId] ?? [];
        if (events.length === 0) return null;
        let snapshot: PageSnapshot | null = null;
        for (const event of events) {
          if (event.anchor) snapshot = structuredClone(event.anchor);
          snapshot = mergePagePatch(snapshot, event.patch);
        }
        return snapshot;
      },

      getLatestDbSnapshot: (databaseId) => {
        const events = get().dbEventsByDatabaseId[databaseId] ?? [];
        if (events.length === 0) return null;
        let snapshot: DatabaseSnapshot | null = null;
        for (const event of events) {
          if (event.anchor) snapshot = structuredClone(event.anchor);
          snapshot = mergeDbPatch(snapshot, event.patch);
        }
        return isValidDatabaseSnapshot(snapshot) ? snapshot : null;
      },

      getPageEvents: (pageId) =>
        [...(get().pageEventsByPageId[pageId] ?? [])].sort((a, b) => b.ts - a.ts),

      getDbEvents: (databaseId) =>
        [...(get().dbEventsByDatabaseId[databaseId] ?? [])].sort(
          (a, b) => b.ts - a.ts,
        ),

      getPageTimeline: (pageId) =>
        groupPageTimeline(
          [...(get().pageEventsByPageId[pageId] ?? [])].sort((a, b) => a.ts - b.ts),
        ),

      getDbTimeline: (databaseId) =>
        groupTimeline(
          [...(get().dbEventsByDatabaseId[databaseId] ?? [])].sort(
            (a, b) => a.ts - b.ts,
          ),
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
        const events = get().pageEventsByPageId[pageId] ?? [];
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
        const events = get().dbEventsByDatabaseId[databaseId] ?? [];
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
        [...(get().deletedRowTombstonesByDbId[databaseId] ?? [])].sort(
          (a, b) => b.ts - a.ts,
        ),

      popDeletedRowTombstone: (databaseId, tombstoneId) => {
        let removed: DeletedRowTombstone | null = null;
        set((state) => {
          const list = state.deletedRowTombstonesByDbId[databaseId] ?? [];
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
        for (const [databaseId, events] of Object.entries(get().dbEventsByDatabaseId)) {
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
      migrate: (persisted) => persisted,
    },
  ),
);

export function shouldWriteAnchor(eventCount: number): boolean {
  return eventCount % HISTORY_ANCHOR_INTERVAL === 0;
}
