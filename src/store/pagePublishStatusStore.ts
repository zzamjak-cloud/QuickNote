// 제목줄과 게시 다이얼로그가 공유하는 세션 전용 웹 게시 상태 캐시.
import { create } from "zustand";

type PagePublishStatusEntry = {
  published: boolean;
  revision: number;
};

type PagePublishStatusState = {
  statusByPageId: Record<string, PagePublishStatusEntry>;
  setPublished: (pageId: string, published: boolean) => void;
  applyFetchedStatus: (
    pageId: string,
    published: boolean,
    expectedRevision: number,
  ) => void;
};

export const usePagePublishStatusStore = create<PagePublishStatusState>(
  (set) => ({
    statusByPageId: {},
    setPublished: (pageId, published) =>
      set((state) => {
        const current = state.statusByPageId[pageId];
        return {
          statusByPageId: {
            ...state.statusByPageId,
            [pageId]: {
              published,
              revision: (current?.revision ?? 0) + 1,
            },
          },
        };
      }),
    applyFetchedStatus: (pageId, published, expectedRevision) =>
      set((state) => {
        const current = state.statusByPageId[pageId];
        if ((current?.revision ?? 0) !== expectedRevision) return state;
        return {
          statusByPageId: {
            ...state.statusByPageId,
            [pageId]: {
              published,
              revision: expectedRevision + 1,
            },
          },
        };
      }),
  }),
);

export function getPagePublishStatusRevision(pageId: string): number {
  return (
    usePagePublishStatusStore.getState().statusByPageId[pageId]?.revision ?? 0
  );
}
