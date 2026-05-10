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
import type { PageSnapshot } from "../types/history";
import { enqueueAsync } from "../lib/sync/runtime";
import { useAuthStore } from "./authStore";
import { useWorkspaceStore } from "./workspaceStore";
import { useSettingsStore } from "./settingsStore";
import { useMemberStore } from "./memberStore";
import { useNotificationStore } from "./notificationStore";
import { debouncePerKey } from "../lib/sync/debouncePerKey";
import { jsonContentEquals } from "../lib/pm/jsonDocEquals";
import { extractMentionMemberHitsFromDoc } from "../lib/comments/extractMentions";
import {
  attachQuarantine,
  attachPersistedMeta,
  mergePersistedSubset,
  migratePersistedStore,
  type PersistedObject,
  type PersistedQuarantine,
} from "../lib/migrations/persistedStore";

// 동기화 헬퍼 — v5 에서는 workspaceId 스코핑 + 작성자 식별자(createdByMemberId)가 필요.
// 현재는 auth sub 를 createdByMemberId fallback 으로 사용한다.
function getCreatedByMemberId(): string {
  const s = useAuthStore.getState().state;
  return s.status === "authenticated" ? s.user.sub : "";
}

function getCurrentMemberId(): string {
  return useMemberStore.getState().me?.memberId ?? getCreatedByMemberId();
}

function getCurrentWorkspaceId(): string {
  return useWorkspaceStore.getState().currentWorkspaceId ?? "";
}

// 클라이언트 number(epoch ms) → GraphQL 경계 string/ISO 변환.
// AppSync AWSJSON 스칼라는 JSON 문자열을 요구한다 — 객체를 그대로 보내면
// 'Variable has an invalid value' 검증 오류로 mutation 이 거부된다.
function toGqlPage(p: Page, createdByMemberId: string): Record<string, unknown> {
  return {
    id: p.id,
    workspaceId: getCurrentWorkspaceId(),
    createdByMemberId,
    title: p.title,
    icon: p.icon ?? null,
    parentId: p.parentId ?? null,
    order: String(p.order),
    databaseId: p.databaseId ?? null,
    doc: JSON.stringify(p.doc),
    dbCells: p.dbCells ? JSON.stringify(p.dbCells) : null,
    createdAt: new Date(p.createdAt).toISOString(),
    updatedAt: new Date(p.updatedAt).toISOString(),
  };
}

function enqueueUpsertPage(p: Page): void {
  // 인증/부트스트랩 미완료 시점에 enqueue 되면 서버 검증에서 거부되어 outbox 에 stale 로 남는다.
  if (!getCurrentWorkspaceId()) {
    console.warn("[sync] upsertPage skipped: workspaceId 미설정", { pageId: p.id });
    return;
  }
  enqueueAsync(
    "upsertPage",
    toGqlPage(p, getCreatedByMemberId()) as unknown as Record<string, unknown> & {
      id: string;
      updatedAt?: string;
    },
  );
}

function jsonText(node: JSONContent | null | undefined): string {
  if (!node) return "";
  if (node.type === "mention") {
    return "";
  }
  const own = typeof node.text === "string" ? node.text : "";
  const child = node.content?.map(jsonText).join(" ") ?? "";
  return `${own} ${child}`.replace(/\s+/g, " ").trim();
}

function blockPreviewById(doc: JSONContent, blockId: string): string {
  let found = "";
  const walk = (node: JSONContent | null | undefined): boolean => {
    if (!node) return false;
    if (node.attrs && node.attrs.id === blockId) {
      found = jsonText(node);
      return true;
    }
    for (const child of node.content ?? []) {
      if (walk(child)) return true;
    }
    return false;
  };
  walk(doc);
  return found;
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

const EMPTY_DOC: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

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
  // 행 페이지의 dbCells 한 항목을 갱신 (title 컬럼 제외)
  setPageDbCell: (pageId: string, columnId: string, value: CellValue) => void;
  restorePageFromLatestHistory: (pageId: string) => boolean;
  restorePageFromHistoryEvent: (pageId: string, eventId: string) => boolean;
};

export type PageStore = PageStoreState & PageStoreActions;

/** zustand persist `version` 과 동일 — 메타 schemaVersion 과 맞춘다 */
const PAGE_STORE_PERSIST_VERSION = 3;

const PAGE_STORE_DATA_KEYS = [
  "pages",
  "activePageId",
  "cacheWorkspaceId",
  "migrationQuarantine",
] as const satisfies readonly (keyof PageStoreState)[];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isJsonDoc(value: unknown): value is JSONContent {
  return isPlainObject(value) && typeof value.type === "string";
}

function coercePage(value: unknown): Page | null {
  if (!isPlainObject(value)) return null;
  if (typeof value.id !== "string" || typeof value.title !== "string") return null;
  if (!isJsonDoc(value.doc)) return null;
  const createdAt = Number(value.createdAt);
  const updatedAt = Number(value.updatedAt);
  if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) return null;
  const order = Number(value.order);
  return {
    id: value.id,
    title: value.title,
    icon: typeof value.icon === "string" ? value.icon : null,
    doc: value.doc,
    parentId: typeof value.parentId === "string" ? value.parentId : null,
    order: Number.isFinite(order) ? order : 0,
    databaseId:
      typeof value.databaseId === "string" ? value.databaseId : undefined,
    dbCells: isPlainObject(value.dbCells)
      ? (value.dbCells as Page["dbCells"])
      : undefined,
    coverImage:
      typeof value.coverImage === "string" ? value.coverImage : null,
    createdAt,
    updatedAt,
  };
}

function coercePageMap(value: unknown): {
  pages: PageMap;
  quarantined: Record<string, unknown>;
} {
  const pages: PageMap = {};
  const quarantined: Record<string, unknown> = {};
  if (!isPlainObject(value)) return { pages, quarantined };
  for (const [key, raw] of Object.entries(value)) {
    const page = coercePage(raw);
    if (page) {
      pages[page.id || key] = page;
    } else {
      quarantined[key] = raw;
    }
  }
  return { pages, quarantined };
}

function validatePagePersistedState(state: PersistedObject): boolean {
  return (
    isPlainObject(state.pages) &&
    (state.activePageId == null || typeof state.activePageId === "string") &&
    (state.cacheWorkspaceId == null || typeof state.cacheWorkspaceId === "string")
  );
}

function normalizePagePersistedState(
  state: PersistedObject,
  fromVersion: number,
): PersistedObject {
  const { pages, quarantined } = coercePageMap(state.pages);
  const next: PersistedObject = {
    ...state,
    pages,
    activePageId:
      typeof state.activePageId === "string" && pages[state.activePageId]
        ? state.activePageId
        : null,
    cacheWorkspaceId:
      typeof state.cacheWorkspaceId === "string" ? state.cacheWorkspaceId : null,
    migrationQuarantine: Array.isArray(state.migrationQuarantine)
      ? state.migrationQuarantine
      : [],
  };
  if (Object.keys(quarantined).length > 0) {
    return attachQuarantine(next, quarantined, fromVersion, {
      quarantineReason: "invalid-page-records",
    });
  }
  return next;
}

export function migratePageStore(
  persisted: unknown,
  fromVersion: number,
): PersistedObject {
  const next = migratePersistedStore(
    persisted,
    fromVersion,
    [
      {
        version: 1,
        migrate: (state) => normalizePagePersistedState(state, fromVersion),
      },
      {
        version: 2,
        migrate: (state) => ({ ...state, cacheWorkspaceId: null }),
      },
      {
        version: 3,
        migrate: (state) => normalizePagePersistedState(state, fromVersion),
      },
    ],
    {
      pages: {},
      activePageId: null,
      cacheWorkspaceId: null,
      migrationQuarantine: [],
    },
    {
      validate: validatePagePersistedState,
      quarantineReason: "invalid-page-store",
    },
  );
  if (fromVersion < PAGE_STORE_PERSIST_VERSION) {
    return attachPersistedMeta(next, {
      migratedAt: new Date().toISOString(),
    });
  }
  return next;
}

function nextOrderForParent(pages: PageMap, parentId: string | null): number {
  const siblings = Object.values(pages).filter((p) => p.parentId === parentId);
  if (siblings.length === 0) return 0;
  return Math.max(...siblings.map((s) => s.order)) + 1;
}

function toPageSnapshot(page: Page): PageSnapshot {
  return {
    id: page.id,
    title: page.title,
    icon: page.icon,
    doc: structuredClone(page.doc),
    parentId: page.parentId,
    order: page.order,
    databaseId: page.databaseId,
    dbCells: page.dbCells ? structuredClone(page.dbCells) : undefined,
  };
}

export function isDescendant(
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
        const workspaceId = useWorkspaceStore.getState().currentWorkspaceId ?? "";
        for (const removedId of removedIds) {
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
          notifyNewPageMentions(id, before.doc, after.doc);
          const skipHistory = options?.skipHistory === true;
          if (!skipHistory) {
            const hs = useHistoryStore.getState();
            const events = hs.pageEventsByPageId[id] ?? [];
            hs.recordPageEvent(
              id,
              "page.doc",
              { id, doc: structuredClone(after.doc) },
              shouldWriteAnchor(events.length + 1) ? toPageSnapshot(after) : undefined,
            );
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
          useSettingsStore.getState().setLastVisitedPageForWorkspace(ws, id);
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

export function selectSortedPages(state: PageStore): Page[] {
  return Object.values(state.pages)
    .filter((p) => p.databaseId == null) // 행 페이지는 사이드바에서 숨김
    .filter((p) => !isFullPageDatabaseHomePage(p)) // DB 전용 홈 페이지는 사이드바에서 숨김
    .sort((a, b) => a.order - b.order);
}

export type PageNode = Page & { children: PageNode[] };

// 트리 셀렉터: parentId 기반 재귀 빌드. 형제들은 order로 정렬.
export function selectPageTree(state: PageStore): PageNode[] {
  const byParent = new Map<string | null, Page[]>();
  for (const p of Object.values(state.pages)) {
    if (p.databaseId != null) continue; // 행 페이지는 트리에서 제외
    if (isFullPageDatabaseHomePage(p)) continue; // DB 전용 홈 페이지는 트리에서 제외
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
    if (isFullPageDatabaseHomePage(p)) continue; // DB 전용 홈 페이지는 검색 결과에도 노출 금지
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

/** 사이드바/트리에서 숨기는 DB 전용 풀페이지 홈 — 랜딩 기본값 계산에도 동일 규칙 적용 */
export function isFullPageDatabaseHomePage(page: Page): boolean {
  const first = page.doc?.content?.[0] as
    | { type?: string; attrs?: Record<string, unknown> }
    | undefined;
  return (
    !!first &&
    first.type === "databaseBlock" &&
    first.attrs?.layout === "fullPage" &&
    typeof first.attrs?.databaseId === "string"
  );
}
