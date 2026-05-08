import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import { zustandStorage } from "../lib/storage/index";
import { scheduleEnqueueClientPrefs } from "../lib/sync/clientPrefsSync";

/** 즐겨찾기 디버그 — 콘솔 필터가 Info 를 숨겨도 보이도록 warn 사용 */
const QN_PREFS_LOG = "[QN clientPrefs]";

function traceClientPrefsAction(
  kind: "toggleFavoritePage" | "reorderFavorites" | "removeFavoritePage",
  detail: Record<string, unknown>,
): void {
  console.warn(`${QN_PREFS_LOG} settingsStore.${kind}`, detail);
  if (typeof window !== "undefined") {
    (window as Window & { __QN_CLIENT_PREFS__?: unknown }).__QN_CLIENT_PREFS__ = {
      kind,
      ...detail,
      at: Date.now(),
    };
  }
}

export type Tab = { pageId: string | null; back?: string[] };

type SettingsState = {
  darkMode: boolean;
  fullWidth: boolean;
  sidebarWidth: number;
  /** 사이드바 접힘 — 접힘 시 좌측 얇은 레일만 표시 */
  sidebarCollapsed: boolean;
  /** 개인 즐겨찾기 페이지 id 순서 */
  favoritePageIds: string[];
  /** 즐겨찾기 LWW 타임스탬프(epoch ms). 서버 clientPrefs 도 동일 필드명. */
  favoritePageIdsUpdatedAt: number;
  expandedIds: string[];
  // 페이지 탭. activeTabIndex 위치의 탭 pageId가 곧 활성 페이지.
  tabs: Tab[];
  activeTabIndex: number;
};

type SettingsActions = {
  toggleDarkMode: () => void;
  setSidebarWidth: (width: number) => void;
  toggleSidebarCollapsed: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleFavoritePage: (pageId: string) => void;
  reorderFavorites: (orderedIds: string[]) => void;
  removeFavoritePage: (pageId: string) => void;
  /** 페이지 삭제 시 즐겨찾기 배열에서 제거 */
  removeFavoritesForPages: (pageIds: string[]) => void;
  toggleExpanded: (id: string) => void;
  setExpanded: (id: string, expanded: boolean) => void;
  // 현재 탭의 pageId만 갱신
  setCurrentTabPage: (pageId: string | null) => void;
  // 새 탭 열기
  openTab: (pageId: string | null) => void;
  // 특정 탭 닫기
  closeTab: (index: number) => void;
  // 탭 활성화
  setActiveTab: (index: number) => void;
  prevTab: () => void;
  nextTab: () => void;
  toggleFullWidth: () => void;
  navBack: () => void;
};

export type SettingsStore = SettingsState & SettingsActions;

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      darkMode: false,
      fullWidth: false,
      sidebarWidth: 260,
      sidebarCollapsed: false,
      favoritePageIds: [],
      favoritePageIdsUpdatedAt: 0,
      expandedIds: [],
      tabs: [{ pageId: null }],
      activeTabIndex: 0,
      toggleDarkMode: () => set((s) => ({ darkMode: !s.darkMode })),
      setSidebarWidth: (width) =>
        set({ sidebarWidth: Math.max(180, Math.min(480, width)) }),
      toggleSidebarCollapsed: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleFavoritePage: (pageId) => {
        traceClientPrefsAction("toggleFavoritePage", { pageId });
        set((s) => {
          const favoritePageIds = s.favoritePageIds.includes(pageId)
            ? s.favoritePageIds.filter((id) => id !== pageId)
            : [...s.favoritePageIds, pageId];
          const favoritePageIdsUpdatedAt = Date.now();
          queueMicrotask(() => scheduleEnqueueClientPrefs());
          return { favoritePageIds, favoritePageIdsUpdatedAt };
        });
      },
      reorderFavorites: (orderedIds) => {
        traceClientPrefsAction("reorderFavorites", { count: orderedIds.length });
        set(() => {
          const favoritePageIds = [...orderedIds];
          const favoritePageIdsUpdatedAt = Date.now();
          queueMicrotask(() => scheduleEnqueueClientPrefs());
          return { favoritePageIds, favoritePageIdsUpdatedAt };
        });
      },
      removeFavoritePage: (pageId) => {
        traceClientPrefsAction("removeFavoritePage", { pageId });
        set((s) => {
          const favoritePageIds = s.favoritePageIds.filter((id) => id !== pageId);
          if (favoritePageIds.length === s.favoritePageIds.length) return s;
          const favoritePageIdsUpdatedAt = Date.now();
          queueMicrotask(() => scheduleEnqueueClientPrefs());
          return { favoritePageIds, favoritePageIdsUpdatedAt };
        });
      },
      removeFavoritesForPages: (pageIds) =>
        set((s) => {
          const rm = new Set(pageIds);
          const next = s.favoritePageIds.filter((id) => !rm.has(id));
          if (next.length === s.favoritePageIds.length) return s;
          const favoritePageIdsUpdatedAt = Date.now();
          queueMicrotask(() => scheduleEnqueueClientPrefs());
          return { favoritePageIds: next, favoritePageIdsUpdatedAt };
        }),
      toggleExpanded: (id) =>
        set((s) => ({
          expandedIds: s.expandedIds.includes(id)
            ? s.expandedIds.filter((x) => x !== id)
            : [...s.expandedIds, id],
        })),
      setExpanded: (id, expanded) =>
        set((s) => ({
          expandedIds: expanded
            ? Array.from(new Set([...s.expandedIds, id]))
            : s.expandedIds.filter((x) => x !== id),
        })),
      setCurrentTabPage: (pageId) =>
        set((s) => {
          const curTab = s.tabs[s.activeTabIndex];
          const cur = curTab?.pageId ?? null;
          if (cur === pageId) return s;
          const back = cur !== null
            ? [...(curTab?.back ?? []), cur].slice(-50)
            : (curTab?.back ?? []);
          const tabs = [...s.tabs];
          tabs[s.activeTabIndex] = { pageId, back };
          return { tabs };
        }),
      navBack: () =>
        set((s) => {
          const curTab = s.tabs[s.activeTabIndex];
          const back = curTab?.back ?? [];
          if (back.length === 0) return s;
          const prevPageId = back[back.length - 1]!;
          const tabs = [...s.tabs];
          tabs[s.activeTabIndex] = { pageId: prevPageId, back: back.slice(0, -1) };
          return { tabs };
        }),
      openTab: (pageId) =>
        set((s) => ({
          tabs: [...s.tabs, { pageId }],
          activeTabIndex: s.tabs.length,
        })),
      closeTab: (index) =>
        set((s) => {
          if (s.tabs.length <= 1) return s;
          const tabs = s.tabs.filter((_, i) => i !== index);
          let activeTabIndex = s.activeTabIndex;
          if (index < s.activeTabIndex) activeTabIndex -= 1;
          if (activeTabIndex >= tabs.length) activeTabIndex = tabs.length - 1;
          if (activeTabIndex < 0) activeTabIndex = 0;
          return { tabs, activeTabIndex };
        }),
      setActiveTab: (index) =>
        set((s) => ({
          activeTabIndex: Math.max(0, Math.min(index, s.tabs.length - 1)),
        })),
      prevTab: () =>
        set((s) => ({
          activeTabIndex: Math.max(0, s.activeTabIndex - 1),
        })),
      nextTab: () =>
        set((s) => ({
          activeTabIndex: Math.min(s.tabs.length - 1, s.activeTabIndex + 1),
        })),
      toggleFullWidth: () => set((s) => ({ fullWidth: !s.fullWidth })),
    }),
    {
      name: "quicknote.settings.v1",
      storage: createJSONStorage(() => zustandStorage),
      version: 4,
      migrate: (persisted: unknown, fromVersion: number) => {
        let p = persisted as Record<string, unknown>;
        if (fromVersion < 2) {
          p = {
            ...p,
            sidebarCollapsed: false,
            favoritePageIds: [],
            favoritePageIdsUpdatedAt: 0,
          };
        }
        if (fromVersion < 3) {
          const ids = Array.isArray(p.favoritePageIds)
            ? (p.favoritePageIds as string[])
            : [];
          const prevTs = Number(p.favoritePageIdsUpdatedAt);
          const favoritePageIdsUpdatedAt =
            Number.isFinite(prevTs) && prevTs > 0
              ? prevTs
              : ids.length > 0
                ? Date.now()
                : 0;
          p = { ...p, favoritePageIdsUpdatedAt };
        }
        // v3 마이그레이션으로 즐겨찾기는 있는데 타임스탬프만 0인 경우 서버 prefs 가 로컬을 덮어쓰는 문제 복구
        if (fromVersion < 4) {
          const ids = Array.isArray(p.favoritePageIds)
            ? (p.favoritePageIds as string[])
            : [];
          let ts = Number(p.favoritePageIdsUpdatedAt);
          if (ids.length > 0 && (!Number.isFinite(ts) || ts <= 0)) {
            ts = Date.now();
          }
          p = { ...p, favoritePageIdsUpdatedAt: ts };
        }
        return p;
      },
    },
  ),
);
