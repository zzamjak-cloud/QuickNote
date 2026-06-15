import { create } from "zustand";
import { persist } from "zustand/middleware";
import { newId } from "../lib/id";
import { makeDeferredStorage } from "../lib/storage/index";

const deferredHistoryStorage = makeDeferredStorage();
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
  getPageEvents: (pageId: string) => PageHistoryEvent[];
  getPageTimeline: (pageId: string) => HistoryTimelineEntry[];
  deletePageHistoryEvents: (pageId: string, eventIds: string[]) => void;
  deleteDbHistoryEvents: (databaseId: string, eventIds: string[]) => void;
  purgeDatabaseHistory: (databaseId: string) => void;
  getPageSnapshotAtEvent: (pageId: string, eventId: string) => PageSnapshot | null;
  getDeletedRowTombstones: (databaseId: string) => DeletedRowTombstone[];
  popDeletedRowTombstone: (databaseId: string, tombstoneId: string) => DeletedRowTombstone | null;
};

export type HistoryStore = HistoryState & HistoryActions;

function trimEventsByRetention<T extends { ts: number }>(events: T[]): T[] {
  const threshold = Date.now() - HISTORY_RETENTION_MAX_AGE_MS;
  const ageFiltered = events.filter((e) => e.ts >= threshold);
  if (ageFiltered.length <= HISTORY_RETENTION_MAX_EVENTS) return ageFiltered;
  return ageFiltered.slice(ageFiltered.length - HISTORY_RETENTION_MAX_EVENTS);
}

/**
 * DB 이벤트 보존 정책 — db.create 베이스라인은 가장 오래돼도 보존한다.
 * (repairDbHistoryBaselineIfNeeded 가 베이스라인 존재 여부로 재시드를 판단하므로)
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

      recordPageEvent: (_pageId, _kind, _patch, _anchor) => {
        // 페이지 버전 히스토리는 서버 기반으로만 기록한다.
        // 로컬 히스토리는 브라우저별로 갈라져 복구 시 데이터 손실을 만들 수 있으므로 비활성화.
        return;
      },
      recordDbEvent: (databaseId, kind, patch, anchor) => {
        // 서버 일원화: DB 히스토리/삭제 복구는 모두 서버가 권위다.
        // (DB 버전 = database-history, row 페이지 변경 = page-history GSI(byDatabaseAndCreatedAt),
        //  삭제된 DB = listTrashedDatabases/restoreDatabase)
        // 로컬에는 repairDbHistoryBaselineIfNeeded 가 쓰는 db.create 베이스라인만 남긴다.
        if (kind !== "db.create") return;
        set((state) => {
          const workspaceId = getCurrentWorkspaceId();
          const editor = getPageEventEditorFields();
          const prev = state.dbEventsByDatabaseId[databaseId] ?? [];
          const nextEvent: DbHistoryEvent = {
            id: newId(),
            ts: Date.now(),
            kind,
            databaseId,
            workspaceId,
            patch,
            anchor,
            ...editor,
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

      getPageEvents: (pageId) =>
        filterCurrentWorkspaceEvents([...(get().pageEventsByPageId[pageId] ?? [])])
          .sort((a, b) => b.ts - a.ts),

      getPageTimeline: (pageId) =>
        groupPageTimeline(
          filterCurrentWorkspaceEvents([
            ...(get().pageEventsByPageId[pageId] ?? []),
          ]).sort((a, b) => a.ts - b.ts),
        ),

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

      // DB의 모든 히스토리 이벤트와 행 톰스톤을 영구 제거 (영구삭제 시 호출)
      purgeDatabaseHistory: (databaseId) => {
        set((state) => {
          const nextEvents = { ...state.dbEventsByDatabaseId };
          delete nextEvents[databaseId];
          const nextTombstones = { ...state.deletedRowTombstonesByDbId };
          delete nextTombstones[databaseId];
          return {
            dbEventsByDatabaseId: nextEvents,
            deletedRowTombstonesByDbId: nextTombstones,
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
    }),
    {
      name: "quicknote.historyStore.v1",
      storage: deferredHistoryStorage,
      version: HISTORY_STORE_VERSION,
      migrate: (persisted) => ({
        ...(persisted && typeof persisted === "object" ? persisted : {}),
        cacheWorkspaceId: null,
      }),
    },
  ),
);

/**
 * db.create 베이스라인이 없는 고아 체인(로컬·원격 적용 순서로 발생)은
 * 삭제 후 현재 bundle 기준으로 재시드한다.
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

/**
 * 페이지 변이 기록 게이트웨이 — getState→이벤트수 조회→shouldWriteAnchor→recordPageEvent 복붙을 단일화.
 * anchor 는 thunk 로 받아 앵커 기록 시점에만 평가한다(page.doc/dbCell 핫패스에서 불필요한 스냅샷 계산 방지).
 */
export function recordPageMutation(
  pageId: string,
  kind: PageHistoryKind,
  patch: Partial<PageSnapshot>,
  anchor: () => PageSnapshot,
): void {
  const hs = useHistoryStore.getState();
  const events = hs.pageEventsByPageId[pageId] ?? [];
  hs.recordPageEvent(
    pageId,
    kind,
    patch,
    shouldWriteAnchor(events.length + 1) ? anchor() : undefined,
  );
}
