import { create } from "zustand";

type TextPromptRequest = {
  title: string;
  placeholder?: string;
  initialValue?: string;
  resolve: (value: string | null) => void;
};

type UiStoreState = {
  /** 사이드 피크 모달로 열어둔 페이지 id (없으면 null) */
  peekPageId: string | null;
  /**
   * 동시에 한 컬럼 헤더 메뉴만 열리도록 글로벌 단일 상태로 관리 (#1).
   * 'add:<dbId>' 같은 비-컬럼 메뉴 키도 받을 수 있도록 string으로.
   */
  openColumnMenuId: string | null;
  /** 슬래시 메뉴 등 비-React 컨텍스트용 단일 입력 모달 */
  textPrompt: TextPromptRequest | null;
};

type UiStoreActions = {
  openPeek: (pageId: string) => void;
  closePeek: () => void;
  setOpenColumnMenu: (id: string | null) => void;
  requestTextPrompt: (
    title: string,
    opts?: { placeholder?: string; initialValue?: string },
  ) => Promise<string | null>;
  completeTextPrompt: (value: string | null) => void;
};

export const useUiStore = create<UiStoreState & UiStoreActions>((set, get) => ({
  peekPageId: null,
  openColumnMenuId: null,
  textPrompt: null,
  openPeek: (pageId) => set({ peekPageId: pageId }),
  closePeek: () => set({ peekPageId: null }),
  setOpenColumnMenu: (id) => set({ openColumnMenuId: id }),
  requestTextPrompt: (title, opts) =>
    new Promise<string | null>((resolve) => {
      set({
        textPrompt: {
          title,
          placeholder: opts?.placeholder,
          initialValue: opts?.initialValue,
          resolve,
        },
      });
    }),
  completeTextPrompt: (value) => {
    const t = get().textPrompt;
    if (t) {
      t.resolve(value);
      set({ textPrompt: null });
    }
  },
}));
