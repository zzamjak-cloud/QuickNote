import { create } from "zustand";

type UiStoreState = {
  /** 사이드 피크 모달로 열어둔 페이지 id (없으면 null) */
  peekPageId: string | null;
  /**
   * 동시에 한 컬럼 헤더 메뉴만 열리도록 글로벌 단일 상태로 관리 (#1).
   * 'add:<dbId>' 같은 비-컬럼 메뉴 키도 받을 수 있도록 string으로.
   */
  openColumnMenuId: string | null;
};

type UiStoreActions = {
  openPeek: (pageId: string) => void;
  closePeek: () => void;
  setOpenColumnMenu: (id: string | null) => void;
};

export const useUiStore = create<UiStoreState & UiStoreActions>((set) => ({
  peekPageId: null,
  openColumnMenuId: null,
  openPeek: (pageId) => set({ peekPageId: pageId }),
  closePeek: () => set({ peekPageId: null }),
  setOpenColumnMenu: (id) => set({ openColumnMenuId: id }),
}));
