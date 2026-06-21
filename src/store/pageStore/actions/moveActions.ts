import type { StoreApi } from "zustand";
import type { PageStore } from "../../pageStore";
import type { Page, PageMap } from "../../../types/page";
import { recordPageMutation } from "../../historyStore";
import {
  enqueueUpsertPage,
  isDescendant,
  toPageSnapshot,
} from "../helpers";

type PageStoreSet = StoreApi<PageStore>["setState"];
type PageStoreGet = StoreApi<PageStore>["getState"];

type MoveActions = Pick<
  PageStore,
  "reorderPages" | "movePage" | "movePageRelative"
>;

export function createMoveActions(
  set: PageStoreSet,
  get: PageStoreGet,
): MoveActions {
  return {
    reorderPages: (orderedIds) => {
      const updatedPages: Page[] = [];
      set((state) => {
        const next: PageMap = { ...state.pages };
        orderedIds.forEach((id, idx) => {
          const page = next[id];
          if (page && page.order !== idx) {
            const updated = { ...page, order: idx, updatedAt: Date.now() };
            next[id] = updated;
            updatedPages.push(updated);
          }
        });
        return { pages: next };
      });
      for (const p of updatedPages) enqueueUpsertPage(p);
    },

    movePage: (id, parentId, index) => {
      const before = get().pages[id];
      const beforePages = get().pages;
      set((state) => {
        const target = state.pages[id];
        if (!target) return state;
        // 자기 자신·자손 아래로의 이동 차단 (순환 방지)
        if (parentId !== null) {
          if (parentId === id) return state;
          if (isDescendant(state.pages, id, parentId)) return state;
        }
        const next: PageMap = {};
        for (const p of Object.values(state.pages)) {
          next[p.id] = p;
        }
        // 동일 타임스탬프로 묶어 LWW·upsertPage 가 형제 순서 전체를 한 번에 인지하도록 함
        const ts = Date.now();
        // 1) 원래 부모에서 제거 후 형제들의 order 재조정
        const oldParent = target.parentId;
        const oldSiblings = Object.values(next)
          .filter((p) => p.parentId === oldParent && p.id !== id)
          .sort((a, b) => a.order - b.order);
        oldSiblings.forEach((p, i) => {
          next[p.id] = { ...p, order: i, updatedAt: ts };
        });
        // 2) 새 부모의 형제 목록에 인덱스 위치로 삽입
        const newSiblings = Object.values(next)
          .filter((p) => p.parentId === parentId && p.id !== id)
          .sort((a, b) => a.order - b.order);
        const clampedIndex = Math.max(0, Math.min(index, newSiblings.length));
        newSiblings.splice(clampedIndex, 0, {
          ...target,
          parentId,
          order: 0,
        });
        newSiblings.forEach((p, i) => {
          next[p.id] = { ...p, order: i, updatedAt: ts };
        });
        return { pages: next };
      });
      const after = get().pages[id];
      if (before && after) {
        const changed =
          before.parentId !== after.parentId || before.order !== after.order;
        if (changed) {
          recordPageMutation(
            id,
            "page.move",
            { id, parentId: after.parentId, order: after.order },
            () => toPageSnapshot(after),
          );
          // 이동된 본인 + 부모 변경/order 재조정으로 영향받은 모든 형제를 enqueue.
          const afterPages = get().pages;
          for (const [pid, p] of Object.entries(afterPages)) {
            const prev = beforePages[pid];
            if (!prev) continue;
            if (prev.parentId !== p.parentId || prev.order !== p.order) {
              enqueueUpsertPage(p, { metaOnly: true });
            }
          }
        }
      }
    },

    movePageRelative: (id, direction) => {
      const state = get();
      const me = state.pages[id];
      if (!me) return;
      const siblings = Object.values(state.pages)
        .filter((p) => p.parentId === me.parentId)
        .sort((a, b) => a.order - b.order);
      const idx = siblings.findIndex((p) => p.id === id);
      if (idx === -1) return;
      const move = get().movePage;

      if (direction === "up") {
        if (idx === 0) return;
        move(id, me.parentId, idx - 1);
        return;
      }
      if (direction === "down") {
        if (idx >= siblings.length - 1) return;
        move(id, me.parentId, idx + 1);
        return;
      }
      if (direction === "indent") {
        // 직전 형제의 마지막 자식으로
        if (idx === 0) return;
        const prev = siblings[idx - 1];
        if (!prev) return;
        move(id, prev.id, Number.MAX_SAFE_INTEGER);
        return;
      }
      if (direction === "outdent") {
        // 조부모의 자식으로 — 현재 부모 직후 위치
        if (me.parentId === null) return;
        const parent = state.pages[me.parentId];
        if (!parent) return;
        const grandSiblings = Object.values(state.pages)
          .filter((p) => p.parentId === parent.parentId)
          .sort((a, b) => a.order - b.order);
        const parentIdx = grandSiblings.findIndex((p) => p.id === parent.id);
        if (parentIdx === -1) return;
        move(id, parent.parentId, parentIdx + 1);
        return;
      }
    },
  };
}
