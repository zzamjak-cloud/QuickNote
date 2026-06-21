import type { StoreApi } from "zustand";
import type { PageStore } from "../../pageStore";
import { recordPageMutation } from "../../historyStore";
import { enqueueUpsertPage, toPageSnapshot } from "../helpers";

type PageStoreSet = StoreApi<PageStore>["setState"];
type PageStoreGet = StoreApi<PageStore>["getState"];

type AppearanceActions = Pick<
  PageStore,
  "setIcon" | "setTitleColor" | "setCoverImage"
>;

export function createAppearanceActions(
  set: PageStoreSet,
  get: PageStoreGet,
): AppearanceActions {
  return {
    setIcon: (id, icon) => {
      const before = get().pages[id];
      set((state) => {
        const current = state.pages[id];
        if (!current) return state;
        return {
          pages: {
            ...state.pages,
            [id]: { ...current, icon, updatedAt: Date.now() },
          },
        };
      });
      const after = get().pages[id];
      if (before && after && before.icon !== after.icon) {
        recordPageMutation(
          id,
          "page.icon",
          { id, icon: after.icon },
          () => toPageSnapshot(after),
        );
        enqueueUpsertPage(after);
      }
    },

    setTitleColor: (id, titleColor) => {
      const before = get().pages[id];
      set((state) => {
        const current = state.pages[id];
        if (!current) return state;
        return {
          pages: {
            ...state.pages,
            [id]: { ...current, titleColor, updatedAt: Date.now() },
          },
        };
      });
      const after = get().pages[id];
      if (before && after && before.titleColor !== after.titleColor) {
        recordPageMutation(
          id,
          "page.titleColor",
          { id, titleColor: after.titleColor ?? null },
          () => toPageSnapshot(after),
        );
        enqueueUpsertPage(after);
      }
    },

    setCoverImage: (id, coverImage) => {
      const before = get().pages[id];
      set((state) => {
        const current = state.pages[id];
        if (!current) return state;
        return {
          pages: {
            ...state.pages,
            [id]: { ...current, coverImage, updatedAt: Date.now() },
          },
        };
      });
      const after = get().pages[id];
      if (before && after && before.coverImage !== after.coverImage) {
        recordPageMutation(
          id,
          "page.coverImage",
          { id, coverImage: after.coverImage },
          () => toPageSnapshot(after),
        );
        enqueueUpsertPage(after);
      }
    },
  };
}
