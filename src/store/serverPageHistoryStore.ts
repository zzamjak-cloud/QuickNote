import { create } from "zustand";
import type { HistoryTimelineEntry, PageHistoryKind } from "../types/history";
import type { GqlPageHistoryEntry } from "../lib/sync/graphql/operations";
import {
  deletePageHistoryEventsApi,
  listPageHistoryApi,
  restorePageVersionApi,
  savePageVersionApi,
} from "../lib/sync/pageHistoryApi";
import { applyRemotePageToStore } from "../lib/sync/storeApply";
import { gqlPageToLocalPage } from "../lib/sync/storeApply/helpers";
import { requestPageBodyRestore } from "../lib/collab/pageCollabRegistry";
import { restoreRowCellsToCollabDoc } from "../lib/collab/dbCellsCollab";
import { clearLocalDeleteGuard } from "../lib/sync/localDeleteGuards";
import { usePageStore, enqueuePageUpsertForSync } from "./pageStore";
import { formatError } from "../lib/util/formatError";

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
  /** 현재 상태를 즉시 버전 체크포인트로 저장(세션 머지 우회). */
  savePageVersion: (pageId: string, workspaceId: string) => Promise<boolean>;
  deletePageHistoryEvents: (pageId: string, workspaceId: string, historyIds: string[]) => Promise<void>;
};

function kindLabel(kind: string): string {
  if (kind === "page.create") return "페이지 생성";
  if (kind === "page.session") return "편집 세션";
  if (kind === "page.restoreVersion") return "버전 복구";
  if (kind === "page.checkpoint") return "버전 저장";
  if (kind === "page.update") return "페이지 수정";
  if (kind === "page.delete") return "페이지 삭제";
  return kind;
}

function toTimelineEntry(entry: GqlPageHistoryEntry): HistoryTimelineEntry {
  const ts = Date.parse(entry.createdAt) || Date.now();
  // 세션 엔트리는 createdAt=세션 시작, lastActivityAt=마지막 편집 — 표시 시각은 마지막 활동 기준.
  const endTs = (entry.lastActivityAt && Date.parse(entry.lastActivityAt)) || ts;
  return {
    id: entry.historyId,
    bucket: "content",
    representativeKind: entry.kind as PageHistoryKind,
    eventIds: [entry.historyId],
    startTs: ts,
    endTs,
    count: 1,
    label: kindLabel(entry.kind),
    lastEditedByMemberId: entry.createdByMemberId ?? undefined,
    lastEditedByName: entry.createdByName ?? undefined,
  };
}

// 원본 엔트리 배열을 타임라인으로 변환. 컴포넌트에서 useMemo 로 감싸 호출하면
// 셀렉터가 매 호출마다 새 배열을 반환하는 문제(불필요한 리렌더)를 피할 수 있다.
export function buildPageTimeline(entries: GqlPageHistoryEntry[]): HistoryTimelineEntry[] {
  return entries.map(toTimelineEntry);
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
    // 사용자가 명시적으로 복원 → 삭제 가드를 해제해야 복원본이 무시/제거되지 않는다.
    clearLocalDeleteGuard("page", pageId, workspaceId);
    const local = gqlPageToLocalPage(restored);
    // 협업 활성 페이지는 Y룸이 본문 권위 — store 만 갱신하면 화면이 안 바뀐다.
    // 열려 있는 Editor 에 재시드(언바인딩→Y룸 본문 교체→재바인딩)를 요청한다(없으면 false → 비협업 폴백).
    requestPageBodyRestore(pageId, local.doc);
    // DB 행 셀: 복원본 셀을 DB Y룸(권위)에 그 시점 상태로 정확히 복원. 협업 비활성이면 no-op.
    if (local.databaseId && local.dbCells) {
      restoreRowCellsToCollabDoc(local.databaseId, pageId, local.dbCells);
    }
    // store 반영(비협업 본문 주입 + 메타). 협업 본문/셀은 위 Y룸 재시드가 권위(preserveCollabDoc 가 로컬 유지).
    applyRemotePageToStore(restored);
    await get().fetchPageHistory(pageId, workspaceId);
    return true;
  },

  savePageVersion: async (pageId, workspaceId) => {
    if (!pageId || !workspaceId) return false;
    await savePageVersionApi(pageId, workspaceId);
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
