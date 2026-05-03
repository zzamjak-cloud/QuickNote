import { create } from "zustand";

type UiStoreState = {
  /** 사이드 피크 모달로 열어둔 페이지 id (없으면 null) */
  peekPageId: string | null;
};

type UiStoreActions = {
  openPeek: (pageId: string) => void;
  closePeek: () => void;
};

export const useUiStore = create<UiStoreState & UiStoreActions>((set) => ({
  peekPageId: null,
  openPeek: (pageId) => set({ peekPageId: pageId }),
  closePeek: () => set({ peekPageId: null }),
}));
