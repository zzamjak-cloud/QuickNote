import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { zustandStorage } from "../lib/storage/index";

type InlineUiKeyInput = {
  workspaceId: string | null;
  memberId: string | null;
  databaseId: string;
};

type DatabaseInlineUiPrefsState = {
  /** `${workspaceId}::${memberId}::${databaseId}` -> 인라인 툴바 접힘 여부 */
  inlineControlsCollapsedByKey: Record<string, boolean>;
};

type DatabaseInlineUiPrefsActions = {
  setInlineControlsCollapsed: (
    keyInput: InlineUiKeyInput,
    collapsed: boolean,
  ) => void;
  clear: () => void;
};

export type DatabaseInlineUiPrefsStore = DatabaseInlineUiPrefsState &
  DatabaseInlineUiPrefsActions;

function normalizeScopePart(value: string | null | undefined, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export function makeInlineControlsPrefsKey({
  workspaceId,
  memberId,
  databaseId,
}: InlineUiKeyInput): string {
  return `${normalizeScopePart(workspaceId, "local")}::${normalizeScopePart(memberId, "anonymous")}::${databaseId}`;
}

export const useDatabaseInlineUiPrefsStore = create<DatabaseInlineUiPrefsStore>()(
  persist(
    (set) => ({
      inlineControlsCollapsedByKey: {},
      setInlineControlsCollapsed: (keyInput, collapsed) =>
        set((state) => ({
          inlineControlsCollapsedByKey: {
            ...state.inlineControlsCollapsedByKey,
            [makeInlineControlsPrefsKey(keyInput)]: collapsed,
          },
        })),
      clear: () => set({ inlineControlsCollapsedByKey: {} }),
    }),
    {
      name: "quicknote.database-inline-ui-prefs.v1",
      storage: createJSONStorage(() => zustandStorage),
    },
  ),
);
