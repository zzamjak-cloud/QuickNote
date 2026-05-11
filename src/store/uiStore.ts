import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { zustandStorage } from "../lib/storage/index";

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

export type FavoriteNavigationRequest = {
  pageId: string;
  workspaceId: string | null;
  requestedAt: number;
};

/** 미전송 outbox 때문에 워크스페이스 전환 시 로컬 캐시 비우기가 한 번 막힌 상태(세션용, persist 제외) */
export type OutboxWorkspaceSwitchHold = {
  pending: number;
  targetWorkspaceId: string;
  /** 캐시 클리어 재시도에 쓰이는 소스 워크스페이스(세션 전환 직전 WS 또는 페이지 캐시 소속) */
  sourceWorkspaceId?: string | null;
};

/** 우측 패널(목차 / 즐겨찾기) 탭 */
export type RightPanelTab = "toc" | "favorites";

/** 블록 댓글 스레드 패널(전역 — 알림 클릭에서도 동일하게 연다) */
export type CommentThreadPayload = {
  pageId: string;
  blockId: string;
  blockStart: number;
  /** "+" 버튼 클릭 시 화면 좌표 — 있으면 패널을 버튼 옆에 붙인다 */
  anchorViewport?: { top: number; left: number; right: number; bottom: number };
  /** true면 블록으로 스크롤·포커스 이동 생략(본문에서 이미 보일 때 깜빡임·임베드 재로드 완화) */
  skipScroll?: boolean;
};

type UiStoreState = {
  /** 우측 패널(목차·즐겨찾기) 열림 */
  rightPanelOpen: boolean;
  rightPanelTab: RightPanelTab;
  /** 사이드바 알림 드롭다운 */
  notificationCenterOpen: boolean;
  /** 블록 댓글 스레드 패널 */
  commentThread: CommentThreadPayload | null;
  peekPageId: string | null;
  peekHistory: string[];
  openColumnMenuId: string | null;
  textPrompt: TextPromptRequest | null;
  rowBackTargetByPageId: Record<string, string>;
  toasts: ToastMessage[];
  pendingFavoriteNavigation: FavoriteNavigationRequest | null;
  outboxWorkspaceSwitchHold: OutboxWorkspaceSwitchHold | null;
};

type UiStoreActions = {
  toggleRightPanel: (tab: RightPanelTab) => void;
  openRightPanel: (tab: RightPanelTab) => void;
  closeRightPanel: () => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  toggleNotificationCenter: () => void;
  closeNotificationCenter: () => void;
  openCommentThread: (payload: CommentThreadPayload) => void;
  closeCommentThread: () => void;
  /** 하위 호환: 즐겨찾기 패널만 토글 */
  toggleFavoritesPanel: () => void;
  openFavoritesPanel: () => void;
  closeFavoritesPanel: () => void;
  openPeek: (pageId: string) => void;
  closePeek: () => void;
  peekNavigate: (pageId: string) => void;
  peekBack: () => void;
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
  requestFavoriteNavigation: (payload: {
    pageId: string;
    workspaceId: string | null;
  }) => void;
  clearFavoriteNavigation: () => void;
  setOutboxWorkspaceSwitchHold: (payload: OutboxWorkspaceSwitchHold | null) => void;
};

function newToastId(): string {
  return `toast-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useUiStore = create<UiStoreState & UiStoreActions>()(
  persist(
    (set, get) => ({
  rightPanelOpen: false,
  rightPanelTab: "favorites",
  notificationCenterOpen: false,
  commentThread: null,
  peekPageId: null,
  peekHistory: [],
  openColumnMenuId: null,
  textPrompt: null,
  rowBackTargetByPageId: {},
  toasts: [],
  pendingFavoriteNavigation: null,
  outboxWorkspaceSwitchHold: null,

  toggleRightPanel: (tab) =>
    set((s) => {
      if (!s.rightPanelOpen) return { rightPanelOpen: true, rightPanelTab: tab };
      if (s.rightPanelTab !== tab) return { rightPanelTab: tab };
      return { rightPanelOpen: false };
    }),
  openRightPanel: (tab) => set({ rightPanelOpen: true, rightPanelTab: tab }),
  closeRightPanel: () => set({ rightPanelOpen: false }),
  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),

  toggleNotificationCenter: () =>
    set((s) => ({ notificationCenterOpen: !s.notificationCenterOpen })),
  closeNotificationCenter: () => set({ notificationCenterOpen: false }),

  // 같은 클릭 사이클에서 포털 배경이 먼저 올라가 mouseup/click 이 배경으로 가며
  // 즉시 닫히는 고스트 클릭을 피하기 위해, 현재 이벤트 처리가 끝난 뒤에 연다.
  openCommentThread: (payload) => {
    queueMicrotask(() => {
      set({ commentThread: payload });
    });
  },
  closeCommentThread: () => set({ commentThread: null }),

  toggleFavoritesPanel: () => get().toggleRightPanel("favorites"),
  openFavoritesPanel: () => get().openRightPanel("favorites"),
  closeFavoritesPanel: () => get().closeRightPanel(),

  openPeek: (pageId) => set({ peekPageId: pageId, peekHistory: [] }),
  closePeek: () => set({ peekPageId: null, peekHistory: [] }),
  peekNavigate: (pageId) =>
    set((s) => ({
      peekHistory: s.peekPageId ? [...s.peekHistory, s.peekPageId] : s.peekHistory,
      peekPageId: pageId,
    })),
  peekBack: () =>
    set((s) => {
      const history = [...s.peekHistory];
      const prevId = history.pop() ?? null;
      return { peekPageId: prevId, peekHistory: history };
    }),
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
  requestFavoriteNavigation: (payload) =>
    set({
      pendingFavoriteNavigation: {
        pageId: payload.pageId,
        workspaceId: payload.workspaceId,
        requestedAt: Date.now(),
      },
    }),
  clearFavoriteNavigation: () => set({ pendingFavoriteNavigation: null }),
  setOutboxWorkspaceSwitchHold: (payload) =>
    set({ outboxWorkspaceSwitchHold: payload }),
}),
    {
      name: "quicknote.ui.v1",
      storage: createJSONStorage(() => zustandStorage),
      partialize: (state) => ({
        rightPanelOpen: state.rightPanelOpen,
        rightPanelTab: state.rightPanelTab,
      }),
    },
  ),
);
