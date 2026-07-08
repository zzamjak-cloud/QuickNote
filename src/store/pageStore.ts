import { create } from "zustand";
import { persist } from "zustand/middleware";
import { deferredPageStorage } from "../lib/storage/index";
import type { JSONContent } from "@tiptap/react";
import type { Page, PageMap } from "../types/page";
import { type CellValue, type ViewKind } from "../types/database";
import { newId } from "../lib/id";
import {
  useHistoryStore,
  recordPageMutation,
} from "./historyStore";
import { useSettingsStore } from "./settingsStore";
import { useNotificationStore } from "./notificationStore";
import { useDatabaseRowIndexStore } from "./databaseRowIndexStore";
import { enqueueAsync } from "../lib/sync/runtime";
import { markLocallyDeletedEntity } from "../lib/sync/localDeleteGuards";
import { debouncePerKey } from "../lib/sync/debouncePerKey";
import { jsonContentEquals } from "../lib/pm/jsonDocEquals";
import { extractMentionMemberHitsFromDoc } from "../lib/comments/extractMentions";
import {
  isLCSchedulerDatabaseId,
} from "../lib/scheduler/database";
import { writeCellsToCollabDoc } from "../lib/collab/dbCellsCollab";
import { LC_SCHEDULER_WORKSPACE_ID } from "../lib/scheduler/scope";
import {
  EMPTY_DOC,
  blockPreviewById,
  enqueueUpsertPage,
  getCurrentMemberId,
  getCurrentWorkspaceId,
  nextOrderForParent,
  toPageSnapshot,
  updateButtonLabelsInDoc,
  allocateUniquePageTitle,
  isPageTitleTaken,
  normalizePageTitle,
  preparePageTitleInput,
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
import { createFullPageDbActions } from "./pageStore/actions/fullPageDbActions";
import { createMoveActions } from "./pageStore/actions/moveActions";
import { createDuplicateActions } from "./pageStore/actions/duplicateActions";
import { createAppearanceActions } from "./pageStore/actions/appearanceActions";

function canRestoreLocalPageHistory(): boolean {
  return false;
}

export { migratePageStore } from "./pageStore/migrations";

// 동기화·헬퍼는 ./pageStore/helpers.ts 로 분리됨.
// 단, notifyNewPageMentions 는 usePageStore 를 참조하므로 순환 회피용으로 본 파일 유지.

function resolveDeletedPageWorkspaceId(page: Page, removedPageById: Map<string, Page>): string {
  if (page.workspaceId) return page.workspaceId;
  let cursor: Page | undefined = page;
  while (cursor) {
    if (isLCSchedulerDatabaseId(cursor.databaseId)) return LC_SCHEDULER_WORKSPACE_ID;
    cursor = cursor.parentId ? removedPageById.get(cursor.parentId) : undefined;
  }
  return getCurrentWorkspaceId();
}

function getFullPageDatabaseId(page: Page): string | null {
  const first = page.doc?.content?.[0] as
    | { type?: string; attrs?: Record<string, unknown> }
    | undefined;
  if (first?.type !== "databaseBlock") return null;
  if (first.attrs?.layout !== "fullPage") return null;
  const databaseId = first.attrs.databaseId;
  return typeof databaseId === "string" && databaseId.trim()
    ? databaseId
    : null;
}

function clearTabsForDeletedFullPageDatabases(
  databaseIds: string[],
  pages: PageMap,
  fallbackPageId: string | null,
): void {
  const idSet = new Set(databaseIds.filter(Boolean));
  if (idSet.size === 0) return;
  const fallback = fallbackPageId && pages[fallbackPageId] ? fallbackPageId : null;
  useSettingsStore.setState((state) => {
    let changed = false;
    const tabs = state.tabs.map((tab) => {
      const databaseId = tab.databaseId ?? null;
      if (!databaseId || !idSet.has(databaseId)) return tab;
      changed = true;
      const back = tab.back ?? [];
      const backTarget =
        [...back].reverse().find((pageId) => pages[pageId]) ?? null;
      return {
        pageId: fallback ?? backTarget,
        databaseId: null,
        back,
      };
    });
    return changed ? { tabs } : state;
  });
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
  /** 여러 페이지(각자 자손 포함)를 한꺼번에 삭제. 삭제 배치는 하나로 묶여 undo 한 번에 복원. */
  deletePages: (ids: string[]) => void;
  /** 마지막으로 삭제한 페이지 배치를 복원. 복원되면 true 반환. */
  undoLastDelete: () => boolean;
  renamePage: (id: string, title: string) => boolean;
  updateDoc: (
    id: string,
    doc: JSONContent,
    options?: { skipHistory?: boolean; deferSync?: boolean },
  ) => void;
  setActivePage: (id: string | null) => void;
  /** 계층 상 부모 페이지로 이동(헤더 뒤로가기). 루트(parentId 없음)면 무시 */
  navigateToParentPage: () => void;
  reorderPages: (orderedIds: string[]) => void;
  setIcon: (id: string, icon: string | null) => void;
  setTitleColor: (id: string, titleColor: string | null) => void;
  setCoverImage: (id: string, coverImage: string | null) => void;
  /** 해당 DB 의 전체 페이지(본문이 fullPage databaseBlock 단독) 페이지 id — 없으면 null */
  findFullPagePageIdForDatabase: (databaseId: string) => string | null;
  /** 해당 DB 의 숨김 fullPage 홈 페이지를 보장하고 page id 반환 */
  ensureFullPagePageForDatabase: (
    databaseId: string,
    title?: string,
    view?: ViewKind,
  ) => string | null;
  /** 임포트 등으로 만든 fullPage DB 홈 페이지에 fullPageDatabaseId 태그를 보강한다(유령 방지) */
  markFullPageDatabaseHome: (pageId: string, databaseId: string) => void;
  // 페이지를 다른 부모/위치로 이동. parentId=null 이면 루트.
  movePage: (id: string, parentId: string | null, index: number) => void;
  // 여러 페이지를 같은 부모/위치로 일괄 이동(사이드바 멀티 선택 드래그). ids 순서 유지.
  movePages: (ids: string[], parentId: string | null, index: number) => void;
  // 키보드 단축키용 상대 이동 (같은 부모 내 위/아래, 들여쓰기/내어쓰기)
  movePageRelative: (
    id: string,
    direction: "up" | "down" | "indent" | "outdent",
  ) => void;
  // 페이지(와 자손)를 복제하여 원본 바로 다음에 삽입. 복제된 루트의 id를 반환.
  duplicatePage: (id: string) => string;
  // 페이지(와 자손 전체)를 다른 워크스페이스로 복제. 복제된 페이지 수를 반환.
  duplicatePageToWorkspace: (
    id: string,
    targetWorkspaceId: string,
  ) => Promise<number>;
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
        const workspaceId = getCurrentWorkspaceId();
        const uniqueTitle = allocateUniquePageTitle(get().pages, title, {
          workspaceId: workspaceId || undefined,
        });
        const page: Page = {
          id,
          workspaceId: workspaceId || undefined,
          title: uniqueTitle,
          icon: null,
          doc: structuredClone(EMPTY_DOC),
          contentLoaded: true,
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
        if (activate) {
          // React 18 자동 배칭: set()과 동일 동기 컨텍스트에서 탭도 갱신 → 단일 렌더로 Editor 마운트
          const st = useSettingsStore.getState();
          if (st.tabs[st.activeTabIndex]?.pageId !== id) {
            st.setCurrentTabPage(id);
          }
        }
        // 생성 직후 렌더를 먼저 확정하고, 기록/동기화는 다음 틱으로 미뤄 체감 지연을 줄인다.
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
          recordPageMutation(
            id,
            "page.delete",
            toPageSnapshot(before),
            () => toPageSnapshot(before),
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
          markLocallyDeletedEntity("page", removedId, workspaceId, Date.parse(nowIso) || Date.now());
          enqueueAsync("softDeletePage", { id: removedId, workspaceId, updatedAt: nowIso });
        }
        if (removedIds.length > 0) {
          useSettingsStore.getState().removeFavoritesForPages(removedIds);
          // 삭제된 페이지(행 포함)를 DB 행 인덱스 캐시에서도 제거 — fallback 으로 유령 행이
          // 계속 렌더되거나(테이블/리스트), 삭제 후에도 화면 갱신이 안 되던 문제 차단.
          void useDatabaseRowIndexStore.getState().removePagesFromAllIndexes(removedIds);
        }
        const removedFullPageDatabaseIds = Array.from(
          new Set(removedPages.map(getFullPageDatabaseId).filter(Boolean) as string[]),
        );
        if (removedFullPageDatabaseIds.length > 0) {
          clearTabsForDeletedFullPageDatabases(
            removedFullPageDatabaseIds,
            get().pages,
            get().activePageId,
          );
        }
      },

      deletePages: (ids) => {
        const pages = get().pages;
        const idSet = new Set(ids);
        // 조상이 함께 선택된 자손은 deletePage 가 서브트리로 함께 지우므로 최상위만 남긴다.
        const topIds = Array.from(idSet).filter((id) => {
          if (!pages[id]) return false;
          let cur = pages[id]?.parentId ?? null;
          while (cur) {
            if (idSet.has(cur)) return false;
            cur = pages[cur]?.parentId ?? null;
          }
          return true;
        });
        if (topIds.length === 0) return;
        const activePageBefore = get().activePageId;
        const mergedPages: Page[] = [];
        for (const id of topIds) {
          get().deletePage(id);
          const batch = get().lastDeletedBatch;
          if (batch) mergedPages.push(...batch.pages);
        }
        // Ctrl+Z 한 번으로 전체 선택 삭제가 복원되도록 배치를 하나로 합친다.
        set({
          lastDeletedBatch: { pages: mergedPages, activePageBefore },
        });
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
        if (!before) return false;
        const nextTitle = preparePageTitleInput(title);
        if (nextTitle === normalizePageTitle(before.title)) return true;
        const ws = before.workspaceId ?? getCurrentWorkspaceId();
        const workspaceId = ws || undefined;
        if (
          isPageTitleTaken(get().pages, nextTitle, {
            exceptId: id,
            workspaceId,
          })
        ) {
          return false;
        }
        set((state) => {
          const current = state.pages[id];
          if (!current) return state;
          return {
            pages: {
              ...state.pages,
              [id]: { ...current, title: nextTitle, updatedAt: Date.now() },
            },
          };
        });
        const after = get().pages[id];
        if (before && after && before.title !== after.title) {
          recordPageMutation(
            id,
            "page.rename",
            { id, title: after.title },
            () => toPageSnapshot(after),
          );
          enqueueUpsertPage(after);
          // 즐겨찾기 스냅샷 제목도 즉시 갱신 — 즐겨찾기 패널 미마운트/페이지 미로드 상태에서
          // 표시 제목이 변경 이전으로 되돌아가는 것을 방지(스냅샷이 옛 제목으로 서버에 재전송되는 것도 차단).
          const settings = useSettingsStore.getState();
          if (settings.favoritePageIds.includes(id)) {
            settings.updateFavoritePageMeta(id, {
              pageId: id,
              workspaceId: after.workspaceId ?? getCurrentWorkspaceId() ?? null,
              workspaceName: settings.favoritePageMetaById[id]?.workspaceName ?? "",
              pageTitle: after.title,
              pageIcon: after.icon ?? null,
            });
          }
        }
        return true;
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
              recordPageMutation(
                id,
                "page.doc",
                { id, doc: structuredClone(latest.doc) },
                () => toPageSnapshot(latest),
              );
            });
          }
          if (options?.deferSync !== true) {
            // 페이지 doc 은 한 글자마다 호출되므로 2초 idle 디바운스로 enqueue 횟수를 줄인다.
            // 발사 시점에 최신 스냅샷을 다시 읽어 최종 본만 보낸다.
            debouncePerKey(`page:${id}`, 2000, () => {
              const latest = get().pages[id];
              if (latest) enqueueUpsertPage(latest);
            });
          }
        }
      },

      setActivePage: (id) => {
        if (get().activePageId !== id) {
          set({ activePageId: id });
        }
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

      ...createMoveActions(set, get),

      ...createAppearanceActions(set, get),

      ...createDuplicateActions(set, get),

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
          recordPageMutation(
            pageId,
            "page.dbCell",
            { id: pageId, dbCells: { [columnId]: value } },
            () => toPageSnapshot(after),
          );
          // 협업 ON DB 행 페이지: 셀을 Y.Doc(실시간 권위)으로 라우팅하고, 동시에 본문을 건드리지 않는
          // cellsOnly upsert 로 Pages.dbCells + 페이지 히스토리에 영속한다. (과거엔 페이지 upsert 를
          // 통째로 생략해 셀이 서버/히스토리에 남지 않아 버전 복원 시 셀이 사라졌다.)
          // 비협업이면 writeCellsToCollabDoc 가 false → 일반 페이지 upsert 경로.
          const routed =
            after.databaseId != null &&
            writeCellsToCollabDoc(after.databaseId, pageId, { [columnId]: value });
          enqueueUpsertPage(after, routed ? { cellsOnly: true } : undefined);
        }
      },

      restorePageFromLatestHistory: (pageId) => {
        if (!canRestoreLocalPageHistory()) {
          console.warn("[history] 로컬 페이지 히스토리 복구는 서버 히스토리 도입 전까지 비활성화됨", { pageId });
          return false;
        }
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
        if (!canRestoreLocalPageHistory()) {
          console.warn("[history] 로컬 페이지 히스토리 복구는 서버 히스토리 도입 전까지 비활성화됨", { pageId, eventId });
          return false;
        }
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

      ...createFullPageDbActions(set, get),
    }),
    {
      name: "quicknote.pages.v1",
      storage: deferredPageStorage,
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
  isProtectedDatabaseBlockPage,
  selectFirstSidebarRootId,
  selectPageTree,
  selectSortedPages,
  type PageNode,
} from "./pageStore/selectors";
