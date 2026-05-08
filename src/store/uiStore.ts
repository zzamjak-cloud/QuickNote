import { create } from "zustand";

type TextPromptRequest = {
  title: string;
  placeholder?: string;
  initialValue?: string;
  resolve: (value: string | null) => void;
};

export type ToastKind = "success" | "info" | "error";

export type ToastMessage = {
  id: string;
  message: string;
  kind: ToastKind;
};

type UiStoreState = {
  /** 우측 즐겨찾기 패널 열림 */
  favoritesPanelOpen: boolean;
  /** 사이드 피크 모달로 열어둔 페이지 id (없으면 null) */
  peekPageId: string | null;
  /**
   * 동시에 한 컬럼 헤더 메뉴만 열리도록 글로벌 단일 상태로 관리 (#1).
   * 'add:<dbId>' 같은 비-컬럼 메뉴 키도 받을 수 있도록 string으로.
   */
  openColumnMenuId: string | null;
  /** 슬래시 메뉴 등 비-React 컨텍스트용 단일 입력 모달 */
  textPrompt: TextPromptRequest | null;
  /** 행 페이지 전체화면 진입 시, 되돌아갈 원본 페이지 id를 기억 */
  rowBackTargetByPageId: Record<string, string>;
  /** 전역 비차단 알림 */
  toasts: ToastMessage[];
};

type UiStoreActions = {
  toggleFavoritesPanel: () => void;
  openFavoritesPanel: () => void;
  closeFavoritesPanel: () => void;
  openPeek: (pageId: string) => void;
  closePeek: () => void;
  setOpenColumnMenu: (id: string | null) => void;
  requestTextPrompt: (
    title: string,
    opts?: { placeholder?: string; initialValue?: string },
  ) => Promise<string | null>;
  completeTextPrompt: (value: string | null) => void;
  setRowBackTarget: (rowPageId: string, pageId: string) => void;
  getRowBackTarget: (rowPageId: string) => string | null;
  clearRowBackTarget: (rowPageId: string) => void;
  showToast: (message: string, opts?: { kind?: ToastKind }) => void;
  dismissToast: (id: string) => void;
};

function newToastId(): string {
  return `toast-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useUiStore = create<UiStoreState & UiStoreActions>((set, get) => ({
  favoritesPanelOpen: false,
  peekPageId: null,
  openColumnMenuId: null,
  textPrompt: null,
  rowBackTargetByPageId: {},
  toasts: [],
  toggleFavoritesPanel: () =>
    set((s) => ({ favoritesPanelOpen: !s.favoritesPanelOpen })),
  openFavoritesPanel: () => set({ favoritesPanelOpen: true }),
  closeFavoritesPanel: () => set({ favoritesPanelOpen: false }),
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
  setRowBackTarget: (rowPageId, pageId) =>
    set((s) => ({
      rowBackTargetByPageId: {
        ...s.rowBackTargetByPageId,
        [rowPageId]: pageId,
      },
    })),
  getRowBackTarget: (rowPageId) =>
    get().rowBackTargetByPageId[rowPageId] ?? null,
  clearRowBackTarget: (rowPageId) =>
    set((s) => {
      if (!(rowPageId in s.rowBackTargetByPageId)) return s;
      const next = { ...s.rowBackTargetByPageId };
      delete next[rowPageId];
      return { rowBackTargetByPageId: next };
    }),
  showToast: (message, opts) => {
    const id = newToastId();
    const kind = opts?.kind ?? "info";
    set((s) => ({
      toasts: [...s.toasts, { id, message, kind }].slice(-4),
    }));
    window.setTimeout(() => {
      get().dismissToast(id);
    }, 2200);
  },
  dismissToast: (id) =>
    set((s) => ({
      toasts: s.toasts.filter((toast) => toast.id !== id),
    })),
}));
