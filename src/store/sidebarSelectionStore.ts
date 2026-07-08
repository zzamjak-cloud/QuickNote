// 사이드바 페이지 멀티 선택 상태(비영속).
// Shift+클릭 범위 선택 → 일괄 드래그 이동·일괄 삭제에 사용한다.

import { create } from "zustand";
import { computeVisibleSidebarPageIds } from "../lib/sidebarVisiblePages";
import { usePageStore } from "./pageStore";

type SidebarSelectionStore = {
  selectedIds: ReadonlySet<string>;
  /** Shift 범위 선택의 기준점 — 마지막 일반 클릭 행 */
  anchorId: string | null;
  clear: () => void;
  /** 일반 클릭 — 멀티 선택 해제 + 앵커 지정 */
  beginAt: (id: string) => void;
  /** Shift+클릭 — 앵커~대상 사이(가시 순서 기준)를 모두 선택 */
  shiftSelectTo: (targetId: string) => void;
};

const EMPTY_SELECTION: ReadonlySet<string> = new Set();

export const useSidebarSelectionStore = create<SidebarSelectionStore>(
  (set, get) => ({
    selectedIds: EMPTY_SELECTION,
    anchorId: null,

    clear: () =>
      set((s) =>
        s.selectedIds.size === 0 ? s : { selectedIds: EMPTY_SELECTION },
      ),

    beginAt: (id) => set({ selectedIds: EMPTY_SELECTION, anchorId: id }),

    shiftSelectTo: (targetId) => {
      const visible = computeVisibleSidebarPageIds();
      const targetIndex = visible.indexOf(targetId);
      if (targetIndex === -1) return;
      // 앵커가 없거나 화면에서 사라졌으면 활성 페이지 → 대상 자신 순으로 폴백.
      const anchorCandidate = get().anchorId;
      const activePageId = usePageStore.getState().activePageId;
      const anchor =
        anchorCandidate && visible.includes(anchorCandidate)
          ? anchorCandidate
          : activePageId && visible.includes(activePageId)
            ? activePageId
            : targetId;
      const anchorIndex = visible.indexOf(anchor);
      const [lo, hi] =
        anchorIndex <= targetIndex
          ? [anchorIndex, targetIndex]
          : [targetIndex, anchorIndex];
      set({
        selectedIds: new Set(visible.slice(lo, hi + 1)),
        anchorId: anchor,
      });
    },
  }),
);
