import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { zustandStorage } from "../lib/storage/index";
import type { JSONContent } from "@tiptap/react";
import type { Page, PageMap } from "../types/page";
import type { CellValue } from "../types/database";
import { newId } from "../lib/id";
import {
  shouldWriteAnchor,
  useHistoryStore,
} from "./historyStore";
import { useSettingsStore } from "./settingsStore";
import { useNotificationStore } from "./notificationStore";
import { enqueueAsync } from "../lib/sync/runtime";
import { debouncePerKey } from "../lib/sync/debouncePerKey";
import { jsonContentEquals } from "../lib/pm/jsonDocEquals";
import { extractMentionMemberHitsFromDoc } from "../lib/comments/extractMentions";
import { getLCSchedulerWorkspaceIdFromDatabaseId } from "../lib/scheduler/database";
import {
  EMPTY_DOC,
  blockPreviewById,
  enqueueUpsertPage,
  getCreatedByMemberId,
  getCurrentMemberId,
  getCurrentWorkspaceId,
  isDescendant,
  nextOrderForParent,
  toPageSnapshot,
  updateButtonLabelsInDoc,
} from "./pageStore/helpers";

export { enqueueUpsertPage as enqueuePageUpsertForSync, isDescendant } from "./pageStore/helpers";
import {
  attachPersistedMeta,
  mergePersistedSubset,
  type PersistedQuarantine,
} from "../lib/migrations/persistedStore";
import {
  PAGE_STORE_DATA_KEYS,
  PAGE_STORE_PERSIST_VERSION,
  migratePageStore,
} from "./pageStore/migrations";

export { migratePageStore } from "./pageStore/migrations";

// 동기화·헬퍼는 ./pageStore/helpers.ts 로 분리됨.
// 단, notifyNewPageMentions 는 usePageStore 를 참조하므로 순환 회피용으로 본 파일 유지.

function resolveDeletedPageWorkspaceId(page: Page, removedPageById: Map<string, Page>): string {
  let cursor: Page | undefined = page;
  while (cursor) {
    if (cursor.databaseId) {
      const schedulerWorkspaceId = getLCSchedulerWorkspaceIdFromDatabaseId(cursor.databaseId);
      if (schedulerWorkspaceId) return schedulerWorkspaceId;
    }
    cursor = cursor.parentId ? removedPageById.get(cursor.parentId) : undefined;
  }
  return getCurrentWorkspaceId();
}

function notifyNewPageMentions(pageId: string, before: JSONContent, after: JSONContent): void {
  const authorMemberId = getCurrentMemberId();
  if (!authorMemberId) return;
  const page = usePageStore.getState().pages[pageId];

  const beforeHits = extractMentionMemberHitsFromDoc(before).filter(
    (hit) => hit.blockId,
  );
  const afterHits = extractMentionMemberHitsFromDoc(after).filter(
    (hit) => hit.blockId,
  );
  const keyOf = (hit: { memberId: string; blockId: string | null }) =>
    `${hit.memberId}:${hit.blockId ?? ""}`;
  const beforeKeys = new Set(beforeHits.map(keyOf));
  const afterKeys = new Set(afterHits.map(keyOf));

  for (const hit of beforeHits) {
    if (!hit.blockId) continue;
    if (afterKeys.has(keyOf(hit))) continue;
    useNotificationStore
      .getState()
      .removeNotificationByCommentId(
        `page:${pageId}:block:${hit.blockId}:member:${hit.memberId}`,
      );
  }

  const notified = new Set<string>();
  for (const hit of afterHits) {
    if (!hit.blockId) continue;
    const key = `${hit.memberId}:${hit.blockId}`;
    const commentId = `page:${pageId}:block:${hit.blockId}:member:${hit.memberId}`;
    const hostPreview =
      hit.previewInlineHostText != null &&
      hit.previewInlineHostText.trim() !== ""
        ? hit.previewInlineHostText.trim()
        : null;
    const previewBody = hostPreview ?? blockPreviewById(after, hit.blockId);
    if (beforeKeys.has(key)) {
      const beforeHit = beforeHits.find(
        (h) => h.blockId && `${h.memberId}:${h.blockId}` === key,
      );
      const beforeHost =
        beforeHit?.previewInlineHostText != null &&
        beforeHit.previewInlineHostText.trim() !== ""
          ? beforeHit.previewInlineHostText.trim()
          : null;
      const beforePreviewBody =
        beforeHost ?? blockPreviewById(before, hit.blockId);
      const notificationStore = useNotificationStore.getState();
      const existing = notificationStore.items.some(
        (item) => item.commentId === commentId,
      );
      if (existing) {
        notificationStore.updateNotificationByCommentId(commentId, {
          pageTitle: page?.title ?? "페이지",
          previewBody,
        });
      } else if (beforePreviewBody !== previewBody) {
        notificationStore.addNotification({
          recipientMemberId: hit.memberId,
          kind: "mention",
          source: "page",
          pageTitle: page?.title ?? "페이지",
          pageId,
          blockId: hit.blockId,
          fromMemberId: authorMemberId,
          commentId,
          previewBody,
        });
      }
      continue;
    }
    if (notified.has(key)) continue;
    notified.add(key);
    useNotificationStore.getState().addNotification({
      recipientMemberId: hit.memberId,
      kind: "mention",
      source: "page",
      pageTitle: page?.title ?? "페이지",
      pageId,
      blockId: hit.blockId,
      fromMemberId: authorMemberId,
      commentId,
      previewBody,
    });
  }
}

type DeletedBatch = {
  /** 삭제 직전의 page 스냅샷들(자손 포함) */
  pages: Page[];
  /** 삭제 직전 활성 페이지 id (복원 후 자동 활성화) */
  activePageBefore: string | null;
};

type PageStoreState = {
  pages: PageMap;
  activePageId: string | null;
  /** 현재 pages 캐시가 소속된 워크스페이스. null이면 구버전/미확정 캐시로 간주한다. */
  cacheWorkspaceId: string | null;
  /** 자동 복구하지 못한 persisted 원본. 사용자 데이터 안전을 위해 삭제하지 않는다. */
  migrationQuarantine: PersistedQuarantine[];
  /** 가장 최근 삭제 배치 — Ctrl+Z 한 번 으로 복원 가능 */
  lastDeletedBatch: DeletedBatch | null;
};

export type CreatePageOptions = {
  /** false 이면 새 페이지를 만들어도 활성 페이지는 바꾸지 않음 (부모 문서 편집용) */
  activate?: boolean;
  /** 설정 시 첫 upsert부터 DB 행 페이지로 보냄(createPage 직후 두 번째 setState 레이스 방지) */
  databaseId?: string;
  dbCells?: Record<string, CellValue>;
};

type PageStoreActions = {
  createPage: (
    title?: string,
    parentId?: string | null,
    opts?: CreatePageOptions,
  ) => string;
  deletePage: (id: string) => void;
  /** 마지막으로 삭제한 페이지 배치를 복원. 복원되면 true 반환. */
  undoLastDelete: () => boolean;
  renamePage: (id: string, title: string) => void;
  updateDoc: (
    id: string,
    doc: JSONContent,
    options?: { skipHistory?: boolean },
  ) => void;
  setActivePage: (id: string | null) => void;
  /** 계층 상 부모 페이지로 이동(헤더 뒤로가기). 루트(parentId 없음)면 무시 */
  navigateToParentPage: () => void;
  reorderPages: (orderedIds: string[]) => void;
  setIcon: (id: string, icon: string | null) => void;
  setCoverImage: (id: string, coverImage: string | null) => void;
  /** 해당 DB 의 전체 페이지(본문이 fullPage databaseBlock 단독) 페이지 id — 없으면 null */
  findFullPagePageIdForDatabase: (databaseId: string) => string | null;
  // 페이지를 다른 부모/위치로 이동. parentId=null 이면 루트.
  movePage: (id: string, parentId: string | null, index: number) => void;
  // 키보드 단축키용 상대 이동 (같은 부모 내 위/아래, 들여쓰기/내어쓰기)
  movePageRelative: (
    id: string,
    direction: "up" | "down" | "indent" | "outdent",
  ) => void;
  // 페이지(와 자손)를 복제하여 원본 바로 다음에 삽입. 복제된 루트의 id를 반환.
  duplicatePage: (id: string) => string;
  // 페이지(와 자손 전체)를 다른 워크스페이스로 복제. 복제된 페이지 수를 반환.
  duplicatePageToWorkspace: (id: string, targetWorkspaceId: string) => number;
  // 행 페이지의 dbCells 한 항목을 갱신 (title 컬럼 제외)
  setPageDbCell: (pageId: string, columnId: string, value: CellValue) => void;
  restorePageFromLatestHistory: (pageId: string) => boolean;
  restorePageFromHistoryEvent: (pageId: string, eventId: string) => boolean;
  // DB 제목 변경 시 해당 DB를 가리키는 buttonBlock 레이블 동기화
  updateButtonBlockLabels: (homePageId: string, newLabel: string) => void;
};

export type PageStore = PageStoreState & PageStoreActions;

// persist 마이그레이션·coerce 헬퍼는 ./pageStore/migrations.ts 로 분리됨.
// 순수 헬퍼(nextOrderForParent, toPageSnapshot, isDescendant, EMPTY_DOC 등)는 ./pageStore/helpers.ts 로 분리됨.

export const usePageStore = create<PageStore>()(
  persist(
    (set, get) => ({
      pages: {},
      activePageId: null,
      cacheWorkspaceId: null,
      migrationQuarantine: [],
      lastDeletedBatch: null,

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
        if (opts?.databaseId) {
          page.databaseId = opts.databaseId;
          page.dbCells = opts.dbCells ?? {};
        }
        set((state) => ({
          pages: { ...state.pages, [id]: page },
          activePageId: activate ? id : state.activePageId,
          cacheWorkspaceId: getCurrentWorkspaceId() || state.cacheWorkspaceId,
        }));
        const hs = useHistoryStore.getState();
        const pageEvents = hs.pageEventsByPageId[id] ?? [];
        hs.recordPageEvent(
          id,
          "page.create",
          toPageSnapshot(page),
          shouldWriteAnchor(pageEvents.length + 1) ? toPageSnapshot(page) : undefined,
        );
        enqueueUpsertPage(page);
        return id;
      },

      deletePage: (id) => {
        const before = get().pages[id];
        // 삭제 대상 id 집합·page 객체를 set 호출 외부에서 보관(enqueue 와 undo 용).
        const removedIds: string[] = [];
        const removedPages: Page[] = [];
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
            if (toRemove.has(pid)) {
              removedPages.push(page);
            } else {
              rest[pid] = page;
            }
          }
          let nextActive = state.activePageId;
          if (state.activePageId && toRemove.has(state.activePageId)) {
            const remaining = Object.values(rest).sort(
              (a, b) => a.order - b.order,
            );
            nextActive = remaining[0]?.id ?? null;
          }
          removedIds.push(...toRemove);
          return {
            pages: rest,
            activePageId: nextActive,
            lastDeletedBatch: {
              pages: removedPages,
              activePageBefore: state.activePageId,
            },
          };
        });
        if (before) {
          const hs = useHistoryStore.getState();
          const events = hs.pageEventsByPageId[id] ?? [];
          hs.recordPageEvent(
            id,
            "page.delete",
            toPageSnapshot(before),
            shouldWriteAnchor(events.length + 1) ? toPageSnapshot(before) : undefined,
          );
        }
        // 삭제된 모든 페이지(자손 포함) 각각에 대해 softDeletePage 를 enqueue.
        const nowIso = new Date().toISOString();
        const removedPageById = new Map(removedPages.map((page) => [page.id, page]));
        for (const removedId of removedIds) {
          const removedPage = removedPageById.get(removedId);
          const workspaceId = removedPage
            ? resolveDeletedPageWorkspaceId(removedPage, removedPageById)
            : getCurrentWorkspaceId();
          enqueueAsync("softDeletePage", { id: removedId, workspaceId, updatedAt: nowIso });
        }
        if (removedIds.length > 0) {
          useSettingsStore.getState().removeFavoritesForPages(removedIds);
        }
      },

      undoLastDelete: () => {
        const batch = get().lastDeletedBatch;
        if (!batch || batch.pages.length === 0) return false;
        set((state) => {
          const next: PageMap = { ...state.pages };
          for (const p of batch.pages) {
            next[p.id] = p;
          }
          const restoreActive =
            batch.activePageBefore && next[batch.activePageBefore]
              ? batch.activePageBefore
              : state.activePageId;
          return {
            pages: next,
            activePageId: restoreActive,
            lastDeletedBatch: null,
          };
        });
        // 서버 측 softDelete record 를 일반 record 로 다시 upsert(덮어쓰기) 해 복원.
        for (const p of batch.pages) {
          enqueueUpsertPage(p);
        }
        return true;
      },

      renamePage: (id, title) => {
        const before = get().pages[id];
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
        const after = get().pages[id];
        if (before && after && before.title !== after.title) {
          const hs = useHistoryStore.getState();
          const events = hs.pageEventsByPageId[id] ?? [];
          hs.recordPageEvent(
            id,
            "page.rename",
            { id, title: after.title },
            shouldWriteAnchor(events.length + 1) ? toPageSnapshot(after) : undefined,
          );
          enqueueUpsertPage(after);
        }
      },

      updateDoc: (id, doc, options) => {
        const before = get().pages[id];
        if (!before) return;
        // 에디터 초기 빈 doc·동일 재저장이 히스토리·원격에 중복 반영되지 않도록 차단
        if (jsonContentEquals(before.doc, doc)) return;

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
        const after = get().pages[id];
        if (before && after) {
          // @멘션 감지: 전체 doc 순회 비용이 크므로 1.5초 디바운스로 처리
          debouncePerKey(`mention:${id}`, 1500, () => {
            const latest = get().pages[id];
            if (latest) notifyNewPageMentions(id, before.doc, latest.doc);
          });
          const skipHistory = options?.skipHistory === true;
          if (!skipHistory) {
            // 히스토리 기록: structuredClone 비용을 줄이기 위해 300ms 디바운스
            debouncePerKey(`history:${id}`, 300, () => {
              const latest = get().pages[id];
              if (!latest) return;
              const hs = useHistoryStore.getState();
              const events = hs.pageEventsByPageId[id] ?? [];
              hs.recordPageEvent(
                id,
                "page.doc",
                { id, doc: structuredClone(latest.doc) },
                shouldWriteAnchor(events.length + 1) ? toPageSnapshot(latest) : undefined,
              );
            });
          }
          // 페이지 doc 은 한 글자마다 호출되므로 2초 idle 디바운스로 enqueue 횟수를 줄인다.
          // 발사 시점에 최신 스냅샷을 다시 읽어 최종 본만 보낸다.
          debouncePerKey(`page:${id}`, 2000, () => {
            const latest = get().pages[id];
            if (latest) enqueueUpsertPage(latest);
          });
        }
      },

      setActivePage: (id) => {
        set({ activePageId: id });
        const ws = getCurrentWorkspaceId();
        if (ws && id) {
          // 렌더 커밋 중 다른 스토어 setState 호출 시 React 무한 루프 발생 방지
          window.setTimeout(() => {
            useSettingsStore.getState().setLastVisitedPageForWorkspace(ws, id);
          }, 0);
        }
      },

      navigateToParentPage: () => {
        const id = get().activePageId;
        if (!id) return;
        const page = get().pages[id];
        const parentId = page?.parentId ?? null;
        if (parentId === null) return;
        const parent = get().pages[parentId];
        if (!parent) return;
        useSettingsStore.getState().replaceCurrentTabPage(parentId);
        set({ activePageId: parentId });
      },

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
          const hs = useHistoryStore.getState();
          const events = hs.pageEventsByPageId[id] ?? [];
          hs.recordPageEvent(
            id,
            "page.icon",
            { id, icon: after.icon },
            shouldWriteAnchor(events.length + 1) ? toPageSnapshot(after) : undefined,
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
          const hs = useHistoryStore.getState();
          const events = hs.pageEventsByPageId[id] ?? [];
          hs.recordPageEvent(
            id,
            "page.coverImage",
            { id, coverImage: after.coverImage },
            shouldWriteAnchor(events.length + 1) ? toPageSnapshot(after) : undefined,
          );
          enqueueUpsertPage(after);
        }
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
            const hs = useHistoryStore.getState();
            const events = hs.pageEventsByPageId[id] ?? [];
            hs.recordPageEvent(
              id,
              "page.move",
              { id, parentId: after.parentId, order: after.order },
              shouldWriteAnchor(events.length + 1)
                ? toPageSnapshot(after)
                : undefined,
            );
            // 이동된 본인 + 부모 변경/order 재조정으로 영향받은 모든 형제를 enqueue.
            const afterPages = get().pages;
            for (const [pid, p] of Object.entries(afterPages)) {
              const prev = beforePages[pid];
              if (!prev) continue;
              if (prev.parentId !== p.parentId || prev.order !== p.order) {
                enqueueUpsertPage(p);
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

      duplicatePageToWorkspace: (id, targetWorkspaceId) => {
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
            title: isRoot ? `${orig.title} (복사본)` : orig.title,
            parentId: isRoot ? null : (cloneMap.get(orig.parentId ?? "") ?? null),
            order: orig.order,
            createdAt: now,
            updatedAt: now,
          };
          enqueueAsync("upsertPage", {
            id: cloned.id,
            workspaceId: targetWorkspaceId,
            createdByMemberId,
            title: cloned.title,
            icon: cloned.icon ?? null,
            coverImage: cloned.coverImage ?? null,
            parentId: cloned.parentId ?? null,
            order: String(cloned.order),
            databaseId: null,
            doc: JSON.stringify(cloned.doc),
            dbCells: null,
            createdAt: new Date(cloned.createdAt).toISOString(),
            updatedAt: new Date(cloned.updatedAt).toISOString(),
          } as unknown as Record<string, unknown> & { id: string; updatedAt?: string });
        }

        return cloneMap.size;
      },

      setPageDbCell: (pageId, columnId, value) => {
        const before = get().pages[pageId];
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
        const after = get().pages[pageId];
        if (before && after) {
          const hs = useHistoryStore.getState();
          const events = hs.pageEventsByPageId[pageId] ?? [];
          hs.recordPageEvent(
            pageId,
            "page.dbCell",
            { id: pageId, dbCells: { [columnId]: value } },
            shouldWriteAnchor(events.length + 1) ? toPageSnapshot(after) : undefined,
          );
          enqueueUpsertPage(after);
        }
      },

      restorePageFromLatestHistory: (pageId) => {
        const snapshot = useHistoryStore.getState().getLatestPageSnapshot(pageId);
        if (!snapshot) return false;
        set((state) => ({
          pages: {
            ...state.pages,
            [pageId]: {
              ...snapshot,
              createdAt: state.pages[pageId]?.createdAt ?? Date.now(),
              updatedAt: Date.now(),
            },
          },
        }));
        const after = get().pages[pageId];
        if (after) enqueueUpsertPage(after);
        return true;
      },

      restorePageFromHistoryEvent: (pageId, eventId) => {
        const snapshot = useHistoryStore
          .getState()
          .getPageSnapshotAtEvent(pageId, eventId);
        if (!snapshot) return false;
        set((state) => ({
          pages: {
            ...state.pages,
            [pageId]: {
              ...snapshot,
              createdAt: state.pages[pageId]?.createdAt ?? Date.now(),
              updatedAt: Date.now(),
            },
          },
        }));
        const after = get().pages[pageId];
        if (after) enqueueUpsertPage(after);
        return true;
      },

      updateButtonBlockLabels: (homePageId, newLabel) => {
        const pages = get().pages;
        const changed: Page[] = [];
        for (const page of Object.values(pages)) {
          if (!page.doc) continue;
          let dirty = false;
          const doc = updateButtonLabelsInDoc(page.doc, homePageId, newLabel, () => { dirty = true; });
          if (dirty) changed.push({ ...page, doc, updatedAt: Date.now() });
        }
        if (changed.length === 0) return;
        set((s) => {
          const next = { ...s.pages };
          for (const p of changed) next[p.id] = p;
          return { pages: next };
        });
        for (const p of changed) enqueueUpsertPage(p);
      },

      findFullPagePageIdForDatabase: (databaseId) => {
        const idWant = databaseId.trim();
        if (!idWant) return null;
        for (const p of Object.values(get().pages)) {
          const content = p.doc?.content;
          if (!content?.length) continue;
          const first = content[0];
          if (
            first?.type === "databaseBlock" &&
            first.attrs &&
            String(first.attrs.databaseId ?? "") === idWant &&
            first.attrs.layout === "fullPage"
          ) {
            return p.id;
          }
        }
        return null;
      },
    }),
    {
      name: "quicknote.pages.v1",
      storage: createJSONStorage(() => zustandStorage),
      version: PAGE_STORE_PERSIST_VERSION,
      migrate: migratePageStore,
      partialize: (state) =>
        attachPersistedMeta(
          {
            pages: state.pages,
            activePageId: state.activePageId,
            cacheWorkspaceId: state.cacheWorkspaceId,
            migrationQuarantine: state.migrationQuarantine,
          },
          {
            schemaVersion: PAGE_STORE_PERSIST_VERSION,
            persistedWorkspaceId: state.cacheWorkspaceId,
          },
        ),
      merge: (persisted, current) =>
        mergePersistedSubset(persisted, current as PageStore, PAGE_STORE_DATA_KEYS),
    }
  )
);


// 트리 셀렉터·필터는 ./pageStore/selectors.ts 로 분리됨.
export {
  createFilterPageTreeSelector,
  filterPageTree,
  isFullPageDatabaseHomePage,
  selectPageTree,
  selectSortedPages,
  type PageNode,
} from "./pageStore/selectors";
