import { create } from "zustand";
import type { HistoryTimelineEntry, PageHistoryKind } from "../types/history";
import type { GqlPageHistoryEntry } from "../lib/sync/graphql/operations";
import {
  deletePageHistoryEventsApi,
  listPageHistoryApi,
  restorePageVersionApi,
} from "../lib/sync/pageHistoryApi";
import { applyRemotePageToStore } from "../lib/sync/storeApply";
import { usePageStore, enqueuePageUpsertForSync } from "./pageStore";

// 베이스라인 시드를 페이지당 세션 1회로 제한(재조회 루프 방지).
const seededBaselinePages = new Set<string>();

type State = {
  byPageId: Record<string, GqlPageHistoryEntry[]>;
  loading: Record<string, boolean>;
  error: Record<string, string | null>;
};

type Actions = {
  fetchPageHistory: (pageId: string, workspaceId: string) => Promise<void>;
  getPageTimeline: (pageId: string) => HistoryTimelineEntry[];
  restorePageHistoryEvent: (pageId: string, workspaceId: string, historyId: string) => Promise<boolean>;
  deletePageHistoryEvents: (pageId: string, workspaceId: string, historyIds: string[]) => Promise<void>;
};

function kindLabel(kind: string): string {
  if (kind === "page.create") return "페이지 생성";
  if (kind === "page.restoreVersion") return "버전 복구";
  if (kind === "page.update") return "페이지 수정";
  return kind;
}

function toTimelineEntry(entry: GqlPageHistoryEntry): HistoryTimelineEntry {
  const ts = Date.parse(entry.createdAt) || Date.now();
  return {
    id: entry.historyId,
    bucket: "content",
    representativeKind: entry.kind as PageHistoryKind,
    eventIds: [entry.historyId],
    startTs: ts,
    endTs: ts,
    count: 1,
    label: kindLabel(entry.kind),
    lastEditedByMemberId: entry.createdByMemberId ?? undefined,
    lastEditedByName: entry.createdByName ?? undefined,
  };
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const useServerPageHistoryStore = create<State & Actions>()((set, get) => ({
  byPageId: {},
  loading: {},
  error: {},

  fetchPageHistory: async (pageId, workspaceId) => {
    if (!pageId || !workspaceId) return;
    set((s) => ({
      loading: { ...s.loading, [pageId]: true },
      error: { ...s.error, [pageId]: null },
    }));
    try {
      const rows = await listPageHistoryApi(pageId, workspaceId, 100);
      set((s) => ({
        byPageId: { ...s.byPageId, [pageId]: rows },
        loading: { ...s.loading, [pageId]: false },
      }));
      // 서버 버전 기록이 0건인 페이지(기능 도입 이전/첫 upsert 누락)는 현재 상태로 upsert 를 보내
      // 서버가 베이스라인 v1 을 기록하게 한다. 기록 반영 후 재조회해 타임라인에 노출.
      if (rows.length === 0 && !seededBaselinePages.has(pageId)) {
        seededBaselinePages.add(pageId);
        const page = usePageStore.getState().pages[pageId];
        if (page) {
          enqueuePageUpsertForSync(page);
          setTimeout(() => {
            void get().fetchPageHistory(pageId, workspaceId);
          }, 1800);
        }
      }
    } catch (err) {
      set((s) => ({
        loading: { ...s.loading, [pageId]: false },
        error: { ...s.error, [pageId]: formatError(err) },
      }));
    }
  },

  getPageTimeline: (pageId) =>
    (get().byPageId[pageId] ?? []).map(toTimelineEntry),

  restorePageHistoryEvent: async (pageId, workspaceId, historyId) => {
    const restored = await restorePageVersionApi({ pageId, workspaceId, historyId });
    applyRemotePageToStore(restored);
    await get().fetchPageHistory(pageId, workspaceId);
    return true;
  },

  deletePageHistoryEvents: async (pageId, workspaceId, historyIds) => {
    if (historyIds.length === 0) return;
    await deletePageHistoryEventsApi(pageId, workspaceId, historyIds);
    set((s) => {
      const existing = s.byPageId[pageId] ?? [];
      const idSet = new Set(historyIds);
      return {
        byPageId: {
          ...s.byPageId,
          [pageId]: existing.filter((entry) => !idSet.has(entry.historyId)),
        },
      };
    });
  },
}));
