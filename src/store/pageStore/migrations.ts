// pageStore persist 마이그레이션 + coerce 헬퍼.
// pageStore.ts 에서 분리 — 동작 변경 없음.

import type { JSONContent } from "@tiptap/react";
import type { Page, PageMap } from "../../types/page";
import { coercePageBlockComments } from "../../lib/comments/blockCommentSnapshot";
import {
  attachPersistedMeta,
  attachQuarantine,
  migratePersistedStore,
  type PersistedObject,
} from "../../lib/migrations/persistedStore";

/** zustand persist `version` 과 동일 — 메타 schemaVersion 과 맞춘다 */
export const PAGE_STORE_PERSIST_VERSION = 4;

export const PAGE_STORE_DATA_KEYS = [
  "pages",
  "activePageId",
  "cacheWorkspaceId",
  "migrationQuarantine",
] as const;

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
    ...(value.blockComments != null
      ? (() => {
          const bc = coercePageBlockComments(value.blockComments);
          return bc ? { blockComments: bc } : {};
        })()
      : {}),
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
      {
        version: 4,
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
