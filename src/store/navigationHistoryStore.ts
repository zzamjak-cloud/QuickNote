import { create } from "zustand";

type State = {
  backStack: string[];
  pushBack: (pageId: string) => void;
  popBack: () => string | undefined;
  peekBack: () => string | undefined;
  clearBack: () => void;
  /** index번째 항목으로 점프 — backStack을 index 이전까지 자르고 해당 pageId 반환 */
  jumpTo: (index: number) => string | undefined;
};

/** 인라인 DB → 전체 DB 전환 시 이전 페이지로 돌아오기 위한 내비게이션 히스토리 스토어. */
export const useNavigationHistoryStore = create<State>((set, get) => ({
  backStack: [],

  pushBack: (pageId) =>
    set((s) => ({ backStack: [...s.backStack, pageId] })),

  popBack: () => {
    const stack = get().backStack;
    if (stack.length === 0) return undefined;
    const last = stack[stack.length - 1];
    set({ backStack: stack.slice(0, -1) });
    return last;
  },

  peekBack: () => {
    const stack = get().backStack;
    return stack[stack.length - 1];
  },

  clearBack: () => set({ backStack: [] }),

  jumpTo: (index) => {
    const stack = get().backStack;
    if (index < 0 || index >= stack.length) return undefined;
    const pageId = stack[index];
    set({ backStack: stack.slice(0, index) });
    return pageId;
  },
}));
