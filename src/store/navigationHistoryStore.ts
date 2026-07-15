import { create } from "zustand";

type State = {
  backStack: string[];
  /**
   * 가장 최근 링크/멘션 이동의 "도착" 페이지 id.
   * 이 페이지에 머무는 동안에는 backStack 을 stale 로 간주하지 않는다
   * (TopBar 의 클리어 로직이 링크로 도착한 일반 페이지의 단일 백스택을 지우지 않도록).
   */
  lastTargetPageId: string | null;
  /** pageId(떠나는 페이지)를 스택에 쌓는다. targetPageId 는 이동한 도착 페이지. */
  pushBack: (pageId: string, targetPageId?: string | null) => void;
  popBack: () => string | undefined;
  peekBack: () => string | undefined;
  clearBack: () => void;
  /** index번째 항목으로 점프 — backStack을 index 이전까지 자르고 해당 pageId 반환 */
  jumpTo: (index: number) => string | undefined;
};

/** 인라인 DB → 전체 DB 전환, 멘션·링크 이동 등에서 이전 페이지로 돌아오기 위한 내비게이션 히스토리 스토어. */
export const useNavigationHistoryStore = create<State>((set, get) => ({
  backStack: [],
  lastTargetPageId: null,

  pushBack: (pageId, targetPageId = null) =>
    set((s) => {
      // 도착 페이지가 이미 스택에 있으면 그 지점까지 잘라낸다 — 링크로 A↔B 왕복 시
      // 경로 트레일에 A>B>A>B 로 같은 페이지가 중복 누적되는 것을 방지(jumpTo 절단과 동일 의미).
      const targetIdx =
        targetPageId != null ? s.backStack.indexOf(targetPageId) : -1;
      const base = targetIdx >= 0 ? s.backStack.slice(0, targetIdx) : s.backStack;
      // 스택 끝과 같은 페이지의 연속 push 는 무시(연속 중복 방지).
      const backStack =
        base[base.length - 1] === pageId ? base : [...base, pageId];
      return { backStack, lastTargetPageId: targetPageId };
    }),

  popBack: () => {
    const stack = get().backStack;
    if (stack.length === 0) return undefined;
    const last = stack[stack.length - 1];
    // 돌아간 페이지를 새 도착 페이지로 기록 — 그 페이지에서 다시 한 단계 더 돌아갈 수 있도록 유지.
    set({ backStack: stack.slice(0, -1), lastTargetPageId: last });
    return last;
  },

  peekBack: () => {
    const stack = get().backStack;
    return stack[stack.length - 1];
  },

  clearBack: () => set({ backStack: [], lastTargetPageId: null }),

  jumpTo: (index) => {
    const stack = get().backStack;
    if (index < 0 || index >= stack.length) return undefined;
    const pageId = stack[index];
    set({ backStack: stack.slice(0, index), lastTargetPageId: pageId });
    return pageId;
  },
}));
