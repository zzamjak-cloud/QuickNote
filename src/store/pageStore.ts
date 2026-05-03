import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { JSONContent } from "@tiptap/react";
import type { Page, PageMap } from "../types/page";
import type { CellValue } from "../types/database";
import { newId } from "../lib/id";

const EMPTY_DOC: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

type PageStoreState = {
  pages: PageMap;
  activePageId: string | null;
};

export type CreatePageOptions = {
  /** false 이면 새 페이지를 만들어도 활성 페이지는 바꾸지 않음 (부모 문서 편집용) */
  activate?: boolean;
};

type PageStoreActions = {
  createPage: (
    title?: string,
    parentId?: string | null,
    opts?: CreatePageOptions,
  ) => string;
  deletePage: (id: string) => void;
  renamePage: (id: string, title: string) => void;
  updateDoc: (id: string, doc: JSONContent) => void;
  setActivePage: (id: string | null) => void;
  reorderPages: (orderedIds: string[]) => void;
  setIcon: (id: string, icon: string | null) => void;
  // 페이지를 다른 부모/위치로 이동. parentId=null 이면 루트.
  movePage: (id: string, parentId: string | null, index: number) => void;
  // 페이지(와 자손)를 복제하여 원본 바로 다음에 삽입. 복제된 루트의 id를 반환.
  duplicatePage: (id: string) => string;
  // 행 페이지의 dbCells 한 항목을 갱신 (title 컬럼 제외)
  setPageDbCell: (pageId: string, columnId: string, value: CellValue) => void;
};

export type PageStore = PageStoreState & PageStoreActions;

function nextOrderForParent(pages: PageMap, parentId: string | null): number {
  const siblings = Object.values(pages).filter((p) => p.parentId === parentId);
  if (siblings.length === 0) return 0;
  return Math.max(...siblings.map((s) => s.order)) + 1;
}

function isDescendant(
  pages: PageMap,
  candidateAncestorId: string,
  nodeId: string,
): boolean {
  // candidateAncestorId가 nodeId의 조상인지 검사 (순환 방지용)
  let cursor: string | null = nodeId;
  while (cursor) {
    if (cursor === candidateAncestorId) return true;
    cursor = pages[cursor]?.parentId ?? null;
  }
  return false;
}

export const usePageStore = create<PageStore>()(
  persist(
    (set, get) => ({
      pages: {},
      activePageId: null,

      createPage: (title = "새 페이지", parentId = null, opts) => {
        const activate = opts?.activate !== false;
        const id = newId();
        const now = Date.now();
        const page: Page = {
          id,
          title,
          icon: null,
          doc: structuredClone(EMPTY_DOC),
          parentId,
          order: nextOrderForParent(get().pages, parentId),
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({
          pages: { ...state.pages, [id]: page },
          activePageId: activate ? id : state.activePageId,
        }));
        return id;
      },

      deletePage: (id) => {
        set((state) => {
          if (!(id in state.pages)) return state;
          // 자식 페이지를 모두 함께 삭제(노션 휴지통 스타일).
          const toRemove = new Set<string>([id]);
          let changed = true;
          while (changed) {
            changed = false;
            for (const p of Object.values(state.pages)) {
              if (p.parentId && toRemove.has(p.parentId) && !toRemove.has(p.id)) {
                toRemove.add(p.id);
                changed = true;
              }
            }
          }
          const rest: PageMap = {};
          for (const [pid, page] of Object.entries(state.pages)) {
            if (!toRemove.has(pid)) rest[pid] = page;
          }
          let nextActive = state.activePageId;
          if (state.activePageId && toRemove.has(state.activePageId)) {
            const remaining = Object.values(rest).sort(
              (a, b) => a.order - b.order,
            );
            nextActive = remaining[0]?.id ?? null;
          }
          return { pages: rest, activePageId: nextActive };
        });
      },

      renamePage: (id, title) => {
        set((state) => {
          const current = state.pages[id];
          if (!current) return state;
          return {
            pages: {
              ...state.pages,
              [id]: { ...current, title, updatedAt: Date.now() },
            },
          };
        });
      },

      updateDoc: (id, doc) => {
        set((state) => {
          const current = state.pages[id];
          if (!current) return state;
          return {
            pages: {
              ...state.pages,
              [id]: { ...current, doc, updatedAt: Date.now() },
            },
          };
        });
      },

      setActivePage: (id) => set({ activePageId: id }),

      reorderPages: (orderedIds) => {
        set((state) => {
          const next: PageMap = { ...state.pages };
          orderedIds.forEach((id, idx) => {
            const page = next[id];
            if (page) next[id] = { ...page, order: idx };
          });
          return { pages: next };
        });
      },

      setIcon: (id, icon) => {
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
      },

      movePage: (id, parentId, index) => {
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
          // 1) 원래 부모에서 제거 후 형제들의 order 재조정
          const oldParent = target.parentId;
          const oldSiblings = Object.values(next)
            .filter((p) => p.parentId === oldParent && p.id !== id)
            .sort((a, b) => a.order - b.order);
          oldSiblings.forEach((p, i) => {
            next[p.id] = { ...p, order: i };
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
            next[p.id] = { ...p, order: i };
          });
          next[id] = {
            ...next[id]!,
            updatedAt: Date.now(),
          };
          return { pages: next };
        });
      },

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
            title: isRoot ? `${orig.title} (복사본)` : orig.title,
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

        return cloneMap.get(id) ?? "";
      },

      setPageDbCell: (pageId, columnId, value) => {
        set((state) => {
          const page = state.pages[pageId];
          if (!page) return state;
          const nextCells = { ...(page.dbCells ?? {}), [columnId]: value };
          return {
            pages: {
              ...state.pages,
              [pageId]: { ...page, dbCells: nextCells, updatedAt: Date.now() },
            },
          };
        });
      },
    }),
    {
      name: "quicknote.pageStore.v1",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

export function selectSortedPages(state: PageStore): Page[] {
  return Object.values(state.pages)
    .filter((p) => p.databaseId == null) // 행 페이지는 사이드바에서 숨김
    .sort((a, b) => a.order - b.order);
}

export type PageNode = Page & { children: PageNode[] };

// 트리 셀렉터: parentId 기반 재귀 빌드. 형제들은 order로 정렬.
export function selectPageTree(state: PageStore): PageNode[] {
  const byParent = new Map<string | null, Page[]>();
  for (const p of Object.values(state.pages)) {
    if (p.databaseId != null) continue; // 행 페이지는 트리에서 제외
    const list = byParent.get(p.parentId) ?? [];
    list.push(p);
    byParent.set(p.parentId, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.order - b.order);
  }
  const build = (parentId: string | null): PageNode[] =>
    (byParent.get(parentId) ?? []).map((p) => ({
      ...p,
      children: build(p.id),
    }));
  return build(null);
}

// 검색 필터: 매치되는 페이지와 그 조상을 함께 반환.
export function filterPageTree(
  state: PageStore,
  query: string,
): PageNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return selectPageTree(state);
  const matched = new Set<string>();
  for (const p of Object.values(state.pages)) {
    if (p.databaseId != null) continue; // 행 페이지는 검색 결과에도 노출 금지
    if (p.title.toLowerCase().includes(q)) matched.add(p.id);
  }
  // 매치된 페이지의 모든 조상 포함
  const include = new Set(matched);
  for (const id of matched) {
    let cursor: string | null = state.pages[id]?.parentId ?? null;
    while (cursor) {
      include.add(cursor);
      cursor = state.pages[cursor]?.parentId ?? null;
    }
  }
  const prune = (nodes: PageNode[]): PageNode[] =>
    nodes
      .filter((n) => include.has(n.id))
      .map((n) => ({ ...n, children: prune(n.children) }));
  return prune(selectPageTree(state));
}
