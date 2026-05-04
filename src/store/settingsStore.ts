import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type Tab = { pageId: string | null };

type SettingsState = {
  darkMode: boolean;
  fullWidth: boolean;
  sidebarWidth: number;
  expandedIds: string[];
  // 페이지 탭. activeTabIndex 위치의 탭 pageId가 곧 활성 페이지.
  tabs: Tab[];
  activeTabIndex: number;
};

type SettingsActions = {
  toggleDarkMode: () => void;
  setSidebarWidth: (width: number) => void;
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
};

export type SettingsStore = SettingsState & SettingsActions;

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      darkMode: false,
      fullWidth: false,
      sidebarWidth: 260,
      expandedIds: [],
      tabs: [{ pageId: null }],
      activeTabIndex: 0,
      toggleDarkMode: () => set((s) => ({ darkMode: !s.darkMode })),
      setSidebarWidth: (width) =>
        set({ sidebarWidth: Math.max(180, Math.min(480, width)) }),
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
          const cur = s.tabs[s.activeTabIndex]?.pageId ?? null;
          if (cur === pageId) return s;
          const tabs = [...s.tabs];
          tabs[s.activeTabIndex] = { pageId };
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
      storage: createJSONStorage(() => localStorage),
      version: 1,
      migrate: (persisted) => persisted,
    },
  ),
);
