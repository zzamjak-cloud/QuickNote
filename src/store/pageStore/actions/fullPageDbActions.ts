import type { StoreApi } from "zustand";
import type { PageStore } from "../../pageStore";
import type { Page } from "../../../types/page";
import { emptyPanelState } from "../../../types/database";
import { newId } from "../../../lib/id";
import { recordPageMutation } from "../../historyStore";
import { isProtectedDatabaseId } from "../../../lib/scheduler/database";
import {
  enqueueUpsertPage,
  getCurrentWorkspaceId,
  nextOrderForParent,
  toPageSnapshot,
} from "../helpers";

type PageStoreSet = StoreApi<PageStore>["setState"];
type PageStoreGet = StoreApi<PageStore>["getState"];

type FullPageDbActions = Pick<
  PageStore,
  | "findFullPagePageIdForDatabase"
  | "ensureFullPagePageForDatabase"
  | "markFullPageDatabaseHome"
>;

export function createFullPageDbActions(
  set: PageStoreSet,
  get: PageStoreGet,
): FullPageDbActions {
  return {
    findFullPagePageIdForDatabase: (databaseId) => {
      const idWant = databaseId.trim();
      if (!idWant) return null;
      for (const p of Object.values(get().pages)) {
        // 메타데이터 필드 우선 — doc 로드 전에도 동작
        if (p.fullPageDatabaseId === idWant) return p.id;
        // 레거시·마이그레이션 페이지: doc content 로 폴백
        const first = p.doc.content?.[0];
        const attrs = first?.attrs as
          | { databaseId?: unknown; layout?: unknown }
          | undefined;
        if (
          first?.type === "databaseBlock" &&
          attrs &&
          String(attrs.databaseId ?? "") === idWant &&
          String(attrs.layout ?? "") === "fullPage"
        ) {
          return p.id;
        }
      }
      return null;
    },

    ensureFullPagePageForDatabase: (databaseId, title = "데이터베이스", view = "table") => {
      const idWant = databaseId.trim();
      if (!idWant) return null;
      if (isProtectedDatabaseId(idWant)) return null;
      const existing = get().findFullPagePageIdForDatabase(idWant);
      if (existing) {
        // 레거시·임포트 등으로 태그가 빠진 홈을 발견하면 보강한다(유령 방지, idempotent).
        get().markFullPageDatabaseHome(existing, idWant);
        return existing;
      }

      const id = newId();
      const now = Date.now();
      const workspaceId = getCurrentWorkspaceId();
      const page: Page = {
        id,
        workspaceId: workspaceId || undefined,
        title: title.trim() || "데이터베이스",
        icon: null,
        fullPageDatabaseId: idWant,
        doc: {
          type: "doc",
          content: [
            {
              type: "databaseBlock",
              attrs: {
                databaseId: idWant,
                layout: "fullPage",
                view,
                panelState: JSON.stringify(emptyPanelState()),
              },
            },
          ],
        },
        parentId: null,
        order: nextOrderForParent(get().pages, null),
        createdAt: now,
        updatedAt: now,
      };

      set((state) => ({
        pages: { ...state.pages, [id]: page },
        cacheWorkspaceId: getCurrentWorkspaceId() || state.cacheWorkspaceId,
      }));

      queueMicrotask(() => {
        recordPageMutation(
          id,
          "page.create",
          toPageSnapshot(page),
          () => toPageSnapshot(page),
        );
        enqueueUpsertPage(page);
      });

      return id;
    },

    markFullPageDatabaseHome: (pageId, databaseId) => {
      const idWant = databaseId.trim();
      if (!idWant) return;
      const existing = get().pages[pageId];
      if (!existing || existing.fullPageDatabaseId === idWant) return;
      const updated: Page = {
        ...existing,
        fullPageDatabaseId: idWant,
        updatedAt: Date.now(),
      };
      set((s) => ({ pages: { ...s.pages, [pageId]: updated } }));
      enqueueUpsertPage(updated);
    },
  };
}
