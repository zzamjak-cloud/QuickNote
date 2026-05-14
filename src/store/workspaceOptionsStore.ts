import { create } from "zustand";

type WorkspaceOptionsState = {
  jobFunctions: string[];
  jobTitles: string[];
  /** CSV 직무 컬럼 기반 직무 카테고리 목록 */
  jobCategories: string[];
  /** CSV 상세직무 컬럼 기반 상세직무 목록 */
  jobDetails: string[];
};

type WorkspaceOptionsActions = {
  setOptions: (opts: Partial<WorkspaceOptionsState>) => void;
  addJobFunction: (value: string) => void;
  removeJobFunction: (value: string) => void;
  addJobTitle: (value: string) => void;
  removeJobTitle: (value: string) => void;
  addJobCategory: (value: string) => void;
  removeJobCategory: (value: string) => void;
  addJobDetail: (value: string) => void;
  removeJobDetail: (value: string) => void;
  clear: () => void;
};

export const useWorkspaceOptionsStore = create<WorkspaceOptionsState & WorkspaceOptionsActions>()(
  (set) => ({
    jobFunctions: [],
    jobTitles: [],
    jobCategories: [],
    jobDetails: [],
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
    addJobCategory: (value) =>
      set((s) => ({
        jobCategories: s.jobCategories.includes(value) ? s.jobCategories : [...s.jobCategories, value],
      })),
    removeJobCategory: (value) =>
      set((s) => ({ jobCategories: s.jobCategories.filter((v) => v !== value) })),
    addJobDetail: (value) =>
      set((s) => ({
        jobDetails: s.jobDetails.includes(value) ? s.jobDetails : [...s.jobDetails, value],
      })),
    removeJobDetail: (value) =>
      set((s) => ({ jobDetails: s.jobDetails.filter((v) => v !== value) })),
    clear: () => set({ jobFunctions: [], jobTitles: [], jobCategories: [], jobDetails: [] }),
  }),
);
