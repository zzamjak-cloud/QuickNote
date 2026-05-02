import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

type SettingsState = {
  darkMode: boolean;
  sidebarWidth: number;
  // 사이드바 트리에서 펼쳐진 페이지 id 목록
  expandedIds: string[];
};

type SettingsActions = {
  toggleDarkMode: () => void;
  setSidebarWidth: (width: number) => void;
  toggleExpanded: (id: string) => void;
  setExpanded: (id: string, expanded: boolean) => void;
};

export type SettingsStore = SettingsState & SettingsActions;

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      darkMode: false,
      sidebarWidth: 260,
      expandedIds: [],
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
    }),
    {
      name: "quicknote.settings.v1",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
