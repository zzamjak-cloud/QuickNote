// databaseStore persist 마이그레이션 + coerce 헬퍼.
// databaseStore.ts 에서 분리 — 동작 변경 없음.

import type { ColumnDef, ColumnType, DatabaseBundle } from "../../types/database";
import {
  attachPersistedMeta,
  attachQuarantine,
  migratePersistedStore,
  type PersistedObject,
  type PersistedQuarantine,
} from "../../lib/migrations/persistedStore";

export type DbMap = Record<string, DatabaseBundle>;

export type DatabaseQuarantine = PersistedQuarantine;

/** zustand persist `version` 과 동일 — 메타 schemaVersion 과 맞춘다 */
export const DATABASE_STORE_PERSIST_VERSION = 3;

export const DATABASE_STORE_DATA_KEYS = [
  "databases",
  "cacheWorkspaceId",
  "migrationQuarantine",
  "dbTemplates",
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const COLUMN_TYPES = new Set<ColumnType>([
  "title",
  "text",
  "number",
  "select",
  "multiSelect",
  "status",
  "date",
  "person",
  "file",
  "checkbox",
  "url",
  "phone",
  "email",
]);

function coerceColumn(value: unknown): ColumnDef | null {
  if (!isPlainObject(value)) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.type !== "string" ||
    !COLUMN_TYPES.has(value.type as ColumnType)
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    type: value.type as ColumnType,
    width: typeof value.width === "number" ? value.width : undefined,
    config: isPlainObject(value.config)
      ? (value.config as ColumnDef["config"])
      : undefined,
  };
}

function coerceDatabaseBundle(value: unknown): DatabaseBundle | null {
  if (!isPlainObject(value) || !isPlainObject(value.meta)) return null;
  const createdAt = Number(value.meta.createdAt);
  const updatedAt = Number(value.meta.updatedAt);
  if (
    typeof value.meta.id !== "string" ||
    typeof value.meta.title !== "string" ||
    !Number.isFinite(createdAt) ||
    !Number.isFinite(updatedAt) ||
    !Array.isArray(value.columns) ||
    !Array.isArray(value.rowPageOrder)
  ) {
    return null;
  }
  const columns = value.columns.map(coerceColumn).filter(Boolean) as ColumnDef[];
  if (columns.length !== value.columns.length) return null;
  return {
    meta: {
      id: value.meta.id,
      title: value.meta.title,
      createdAt,
      updatedAt,
    },
    columns,
    rowPageOrder: value.rowPageOrder.filter(
      (pageId): pageId is string => typeof pageId === "string",
    ),
  };
}

function coerceDatabaseMap(value: unknown): {
  databases: DbMap;
  quarantined: Record<string, unknown>;
} {
  const databases: DbMap = {};
  const quarantined: Record<string, unknown> = {};
  if (!isPlainObject(value)) return { databases, quarantined };
  for (const [key, raw] of Object.entries(value)) {
    const bundle = coerceDatabaseBundle(raw);
    if (bundle) {
      databases[bundle.meta.id || key] = bundle;
    } else {
      quarantined[key] = raw;
    }
  }
  return { databases, quarantined };
}

function validateDatabasePersistedState(state: PersistedObject): boolean {
  return (
    isPlainObject(state.databases) &&
    (state.cacheWorkspaceId == null || typeof state.cacheWorkspaceId === "string")
  );
}

function normalizeDatabasePersistedState(
  state: PersistedObject,
  fromVersion: number,
): PersistedObject {
  const { databases, quarantined } = coerceDatabaseMap(state.databases);
  const next: PersistedObject = {
    ...state,
    databases,
    cacheWorkspaceId:
      typeof state.cacheWorkspaceId === "string" ? state.cacheWorkspaceId : null,
    migrationQuarantine: Array.isArray(state.migrationQuarantine)
      ? state.migrationQuarantine
      : [],
  };
  if (Object.keys(quarantined).length > 0) {
    return attachQuarantine(next, quarantined, fromVersion, {
      quarantineReason: "invalid-database-records",
    });
  }
  return next;
}

export function migrateDatabaseStore(
  persisted: unknown,
  fromVersion: number,
): PersistedObject {
  const next = migratePersistedStore(
    persisted,
    fromVersion,
    [
      {
        version: 1,
        migrate: (state) =>
          normalizeDatabasePersistedState(state, fromVersion),
      },
      {
        version: 2,
        migrate: (state) => ({ ...state, cacheWorkspaceId: null }),
      },
      {
        version: 3,
        migrate: (state) =>
          normalizeDatabasePersistedState(state, fromVersion),
      },
    ],
    { databases: {}, cacheWorkspaceId: null, migrationQuarantine: [] },
    {
      validate: validateDatabasePersistedState,
      quarantineReason: "invalid-database-store",
    },
  );
  if (fromVersion < DATABASE_STORE_PERSIST_VERSION) {
    return attachPersistedMeta(next, {
      migratedAt: new Date().toISOString(),
    });
  }
  return next;
}
