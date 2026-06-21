import type { StoreApi } from "zustand";
import type { PageStore } from "../../pageStore";
import type { Page, PageMap } from "../../../types/page";
import { newId } from "../../../lib/id";
import { fetchPageMetasByWorkspace } from "../../../lib/sync/bootstrap";
import { enqueueAsync } from "../../../lib/sync/runtime";
import { toUpsertPageInput } from "../../../lib/sync/mappers/upsertPageInput";
import {
  allocateUniquePageTitle,
  collectWorkspacePages,
  enqueueUpsertPage,
  getCreatedByMemberId,
  mergeRemotePageMetasIntoMap,
  normalizePageTitle,
} from "../helpers";

type PageStoreSet = StoreApi<PageStore>["setState"];
type PageStoreGet = StoreApi<PageStore>["getState"];

type DuplicateActions = Pick<
  PageStore,
  "duplicatePage" | "duplicatePageToWorkspace"
>;

export function createDuplicateActions(
  set: PageStoreSet,
  get: PageStoreGet,
): DuplicateActions {
  return {
    duplicatePage: (id) => {
      const state = get();
      const source = state.pages[id];
      if (!source) return "";

      const cloneMap = new Map<string, string>();

      const cloneSubtree = (pageId: string): void => {
        const page = state.pages[pageId];
        if (!page) return;
        const clonedId = newId();
        cloneMap.set(pageId, clonedId);
        const children = Object.values(state.pages).filter(
          (p) => p.parentId === pageId
        );
        for (const child of children) {
          cloneSubtree(child.id);
        }
      };
      cloneSubtree(id);

      const now = Date.now();
      const newPages: PageMap = {};
      for (const [origId, newPageId] of cloneMap.entries()) {
        const orig = state.pages[origId]!;
        const isRoot = origId === id;
        newPages[newPageId] = {
          ...orig,
          id: newPageId,
          doc: structuredClone(orig.doc),
          dbCells: orig.dbCells
            ? structuredClone(orig.dbCells)
            : orig.dbCells,
          blockComments: orig.blockComments
            ? {
                messages: orig.blockComments.messages.map((m) => ({
                  ...m,
                  id: newId(),
                  pageId: newPageId,
                })),
                threadVisitedAt: { ...orig.blockComments.threadVisitedAt },
              }
            : undefined,
          title: isRoot ? `${orig.title} (Copy)` : orig.title,
          parentId: isRoot
            ? orig.parentId
            : cloneMap.get(orig.parentId ?? "") ?? orig.parentId,
          order: isRoot ? orig.order + 0.5 : orig.order,
          createdAt: now,
          updatedAt: now,
        };
      }

      set((s) => {
        const merged = { ...s.pages, ...newPages };
        const siblings = Object.values(merged)
          .filter((p) => p.parentId === source.parentId)
          .sort((a, b) => a.order - b.order);
        siblings.forEach((p, i) => {
          merged[p.id] = { ...merged[p.id]!, order: i };
        });
        return { pages: merged };
      });

      // 복제된 모든 페이지(자손 포함)와 정렬 재조정으로 영향받은 형제까지 enqueue.
      const afterPages = get().pages;
      const clonedIds = new Set(cloneMap.values());
      for (const [pid, p] of Object.entries(afterPages)) {
        if (clonedIds.has(pid)) {
          enqueueUpsertPage(p);
        } else if (
          p.parentId === source.parentId &&
          state.pages[pid] &&
          state.pages[pid]!.order !== p.order
        ) {
          enqueueUpsertPage(p);
        }
      }

      return cloneMap.get(id) ?? "";
    },

    duplicatePageToWorkspace: async (id, targetWorkspaceId) => {
      const state = get();
      const source = state.pages[id];
      if (!source) return 0;

      const cloneMap = new Map<string, string>();
      const cloneSubtree = (pageId: string): void => {
        if (!state.pages[pageId]) return;
        cloneMap.set(pageId, newId());
        const children = Object.values(state.pages).filter((p) => p.parentId === pageId);
        for (const child of children) cloneSubtree(child.id);
      };
      cloneSubtree(id);

      const targetPages = collectWorkspacePages(state.pages, targetWorkspaceId);
      try {
        const metas = await fetchPageMetasByWorkspace(targetWorkspaceId);
        mergeRemotePageMetasIntoMap(targetPages, metas, targetWorkspaceId);
      } catch (err) {
        console.error("[pageStore] duplicatePageToWorkspace title fetch failed", err);
      }

      const reservedTitles = new Set<string>();
      const titleByOrigId = new Map<string, string>();
      for (const origId of cloneMap.keys()) {
        const orig = state.pages[origId];
        if (!orig) continue;
        const uniqueTitle = allocateUniquePageTitle(targetPages, orig.title, {
          workspaceId: targetWorkspaceId,
          reservedTitles,
        });
        reservedTitles.add(normalizePageTitle(uniqueTitle));
        titleByOrigId.set(origId, uniqueTitle);
      }

      const now = Date.now();
      const createdByMemberId = getCreatedByMemberId();

      for (const [origId, newPageId] of cloneMap.entries()) {
        const orig = state.pages[origId]!;
        const isRoot = origId === id;
        const cloned: Page = {
          ...orig,
          id: newPageId,
          doc: structuredClone(orig.doc),
          dbCells: orig.dbCells ? structuredClone(orig.dbCells) : orig.dbCells,
          blockComments: undefined,
          title: titleByOrigId.get(origId) ?? orig.title,
          workspaceId: targetWorkspaceId || undefined,
          parentId: isRoot ? null : (cloneMap.get(orig.parentId ?? "") ?? null),
          order: orig.order,
          createdAt: now,
          updatedAt: now,
        };
        // 손작성 input 을 단일 매퍼로 일원화 — Page 필드 추가 시 이 경로만
        // 누락되는 회귀(PageMeta 소실류)를 방지한다. includeMetaColors 로
        // titleColor 까지 보존(기존 손작성은 titleColor 를 누락했음).
        // databaseId/dbCells 는 페이지 복제이므로 null, fullPageDatabaseId 는
        // 유령 페이지 방지를 위해 싣지 않는다(includeFullPageDatabaseId 미지정).
        enqueueAsync("upsertPage", toUpsertPageInput(cloned, createdByMemberId, {
          workspaceId: targetWorkspaceId,
          databaseId: null,
          dbCells: null,
          includeMetaColors: true,
        }) as unknown as Record<string, unknown> & { id: string; updatedAt?: string });
      }

      return cloneMap.size;
    },
  };
}
