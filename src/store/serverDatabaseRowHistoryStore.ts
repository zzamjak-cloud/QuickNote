import { create } from "zustand";
import type { HistoryTimelineEntry, PageHistoryKind } from "../types/history";
import type { GqlPageHistoryEntry } from "../lib/sync/graphql/operations";
import { listDatabaseRowHistoryApi } from "../lib/sync/pageHistoryApi";
import { buildPageHistorySnapshotMap } from "../lib/history/pageHistoryPatch";
import { formatError } from "../lib/util/formatError";

// DB 소속 row 페이지들의 page-history 를 DB 단위로 모아 보여주기 위한 집계 스토어.
// 서버 byDatabaseAndCreatedAt GSI 단일 쿼리 + 서버 페이지네이션으로 N+1 을 제거한다.
// 삭제된 행의 히스토리도 함께 반환된다(GSI 는 현재 rowPageOrder 와 무관).

const PAGE_LIMIT = 100;

/** DB 히스토리 뷰에 합쳐 보여줄 row 페이지 이벤트 — 소속 row 정보로 태깅 */
export type RowActivityEntry = HistoryTimelineEntry & {
  rowPageId: string;
  rowTitle: string;
};

type State = {
  byDatabaseId: Record<string, RowActivityEntry[]>;
  nextTokenByDatabaseId: Record<string, string | null>;
  loading: Record<string, boolean>;
  error: Record<string, string | null>;
};

type Actions = {
  /** 첫 페이지 로드(기존 누적 초기화). */
  fetchDatabaseRowActivity: (databaseId: string, workspaceId: string) => Promise<void>;
  /** 다음 페이지 누적 로드. nextToken 이 있을 때만 동작. */
  loadMoreDatabaseRowActivity: (databaseId: string, workspaceId: string) => Promise<void>;
  getRowActivity: (databaseId: string) => RowActivityEntry[];
  hasMore: (databaseId: string) => boolean;
};

function pageKindLabel(kind: string): string {
  if (kind === "page.create") return "생성";
  if (kind === "page.restoreVersion") return "버전 복구";
  if (kind === "page.update") return "수정";
  if (kind === "page.delete") return "삭제";
  return kind;
}

/**
 * 엔트리에서 pageId 별 최신 제목을 구한다.
 * 스냅샷(anchor+patch 누적)을 만들어 title 을 뽑고, 없으면 "제목 없음".
 */
function buildTitleMap(
  entries: GqlPageHistoryEntry[],
  workspaceId: string,
): Map<string, string> {
  const byPage = new Map<string, GqlPageHistoryEntry[]>();
  for (const entry of entries) {
    const list = byPage.get(entry.pageId);
    if (list) list.push(entry);
    else byPage.set(entry.pageId, [entry]);
  }
  const out = new Map<string, string>();
  for (const [pageId, list] of byPage) {
    const snapshotMap = buildPageHistorySnapshotMap(list, pageId, workspaceId);
    // 가장 마지막(최신) 엔트리의 스냅샷 제목
    const latest = [...list].sort((a, b) => {
      const at = Date.parse(a.createdAt) || 0;
      const bt = Date.parse(b.createdAt) || 0;
      return at - bt;
    });
    const last = latest[latest.length - 1];
    const snap = last ? snapshotMap.get(last.historyId) : null;
    const title = typeof snap?.title === "string" ? snap.title.trim() : "";
    out.set(pageId, title || "제목 없음");
  }
  return out;
}

function toEntries(
  rows: GqlPageHistoryEntry[],
  workspaceId: string,
): RowActivityEntry[] {
  const titleMap = buildTitleMap(rows, workspaceId);
  return rows
    .map((entry) => {
      const ts = Date.parse(entry.createdAt) || 0;
      const title = titleMap.get(entry.pageId) ?? "제목 없음";
      return {
        id: entry.historyId,
        bucket: "content" as const,
        representativeKind: entry.kind as PageHistoryKind,
        eventIds: [entry.historyId],
        startTs: ts,
        endTs: ts,
        count: 1,
        label: `「${title}」 ${pageKindLabel(entry.kind)}`,
        lastEditedByMemberId: entry.createdByMemberId ?? undefined,
        lastEditedByName: entry.createdByName ?? undefined,
        rowPageId: entry.pageId,
        rowTitle: title,
      };
    })
    .sort((a, b) => b.endTs - a.endTs);
}

export const useServerDatabaseRowHistoryStore = create<State & Actions>()((set, get) => ({
  byDatabaseId: {},
  nextTokenByDatabaseId: {},
  loading: {},
  error: {},

  fetchDatabaseRowActivity: async (databaseId, workspaceId) => {
    if (!databaseId || !workspaceId) return;
    if (get().loading[databaseId]) return;
    set((s) => ({
      loading: { ...s.loading, [databaseId]: true },
      error: { ...s.error, [databaseId]: null },
    }));
    try {
      const { items, nextToken } = await listDatabaseRowHistoryApi(
        databaseId,
        workspaceId,
        PAGE_LIMIT,
      );
      set((s) => ({
        byDatabaseId: { ...s.byDatabaseId, [databaseId]: toEntries(items, workspaceId) },
        nextTokenByDatabaseId: { ...s.nextTokenByDatabaseId, [databaseId]: nextToken },
        loading: { ...s.loading, [databaseId]: false },
      }));
    } catch (err) {
      set((s) => ({
        loading: { ...s.loading, [databaseId]: false },
        error: { ...s.error, [databaseId]: formatError(err) },
      }));
    }
  },

  loadMoreDatabaseRowActivity: async (databaseId, workspaceId) => {
    if (!databaseId || !workspaceId) return;
    const token = get().nextTokenByDatabaseId[databaseId];
    if (!token || get().loading[databaseId]) return;
    set((s) => ({ loading: { ...s.loading, [databaseId]: true } }));
    try {
      const { items, nextToken } = await listDatabaseRowHistoryApi(
        databaseId,
        workspaceId,
        PAGE_LIMIT,
        token,
      );
      set((s) => {
        const prev = s.byDatabaseId[databaseId] ?? [];
        const merged = [...prev, ...toEntries(items, workspaceId)].sort(
          (a, b) => b.endTs - a.endTs,
        );
        return {
          byDatabaseId: { ...s.byDatabaseId, [databaseId]: merged },
          nextTokenByDatabaseId: { ...s.nextTokenByDatabaseId, [databaseId]: nextToken },
          loading: { ...s.loading, [databaseId]: false },
        };
      });
    } catch (err) {
      set((s) => ({
        loading: { ...s.loading, [databaseId]: false },
        error: { ...s.error, [databaseId]: formatError(err) },
      }));
    }
  },

  getRowActivity: (databaseId) => get().byDatabaseId[databaseId] ?? [],
  hasMore: (databaseId) => Boolean(get().nextTokenByDatabaseId[databaseId]),
}));
