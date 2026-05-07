import { create } from "zustand";

type WorkspaceOptionsState = {
  jobFunctions: string[];
  jobTitles: string[];
};

type WorkspaceOptionsActions = {
  setOptions: (opts: Partial<WorkspaceOptionsState>) => void;
  addJobFunction: (value: string) => void;
  removeJobFunction: (value: string) => void;
  addJobTitle: (value: string) => void;
  removeJobTitle: (value: string) => void;
  clear: () => void;
};

export const useWorkspaceOptionsStore = create<WorkspaceOptionsState & WorkspaceOptionsActions>()(
  (set) => ({
    jobFunctions: [],
    jobTitles: [],
    setOptions: (opts) => set((s) => ({ ...s, ...opts })),
    addJobFunction: (value) =>
      set((s) => ({
        jobFunctions: s.jobFunctions.includes(value) ? s.jobFunctions : [...s.jobFunctions, value],
      })),
    removeJobFunction: (value) =>
      set((s) => ({ jobFunctions: s.jobFunctions.filter((v) => v !== value) })),
    addJobTitle: (value) =>
      set((s) => ({
        jobTitles: s.jobTitles.includes(value) ? s.jobTitles : [...s.jobTitles, value],
      })),
    removeJobTitle: (value) =>
      set((s) => ({ jobTitles: s.jobTitles.filter((v) => v !== value) })),
    clear: () => set({ jobFunctions: [], jobTitles: [] }),
  }),
);
