// databaseStore persist 마이그레이션 + coerce 헬퍼.
// databaseStore.ts 에서 분리 — 동작 변경 없음.

import type { DatabaseBundle } from "../../types/database";
import {
  attachPersistedMeta,
  attachQuarantine,
  migratePersistedStore,
  type PersistedObject,
  type PersistedQuarantine,
} from "../../lib/migrations/persistedStore";
import { normalizeDatabaseBundle } from "../../lib/database/schema/normalizeDatabase";
import {
  isLegacyLCSchedulerDatabaseId,
  isLCSchedulerDatabaseId,
  isLCFeatureDatabaseId,
  normalizeLCSchedulerReferenceColumns,
} from "../../lib/scheduler/database";
import { normalizeLCFeatureColumns } from "../../lib/scheduler/featureDatabase";

export type DbMap = Record<string, DatabaseBundle>;

export type DatabaseQuarantine = PersistedQuarantine;

/** zustand persist `version` 과 동일 — 메타 schemaVersion 과 맞춘다 */
export const DATABASE_STORE_PERSIST_VERSION = 5;

export const DATABASE_STORE_DATA_KEYS = [
  "databases",
  "cacheWorkspaceId",
  "migrationQuarantine",
  "dbTemplates",
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function coerceDatabaseMap(value: unknown): {
  databases: DbMap;
  quarantined: Record<string, unknown>;
} {
  const databases: DbMap = {};
  const quarantined: Record<string, unknown> = {};
  if (!isPlainObject(value)) return { databases, quarantined };
  for (const [key, raw] of Object.entries(value)) {
    const bundle = normalizeDatabaseBundle(raw);
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

function cleanupLegacyLCSchedulerDatabases(state: PersistedObject): PersistedObject {
  if (!isPlainObject(state.databases)) return state;
  const databases = { ...(state.databases as DbMap) };
  let changed = false;

  for (const databaseId of Object.keys(databases)) {
    if (!isLegacyLCSchedulerDatabaseId(databaseId)) continue;
    delete databases[databaseId];
    changed = true;
  }

  if (!changed) return state;
  return { ...state, databases };
}

function normalizeLCReferenceDatabases(state: PersistedObject): PersistedObject {
  if (!isPlainObject(state.databases)) return state;
  const databases = { ...(state.databases as DbMap) };
  let changed = false;

  for (const [databaseId, database] of Object.entries(databases)) {
    const normalized = isLCSchedulerDatabaseId(databaseId)
      ? normalizeLCSchedulerReferenceColumns(database.columns)
      : isLCFeatureDatabaseId(databaseId)
        ? normalizeLCFeatureColumns(database.columns)
        : { columns: database.columns, changed: false };
    if (!normalized.changed) continue;
    databases[databaseId] = {
      ...database,
      columns: normalized.columns,
      meta: { ...database.meta, updatedAt: Math.max(database.meta.updatedAt, Date.now()) },
    };
    changed = true;
  }

  return changed ? { ...state, databases } : state;
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
      {
        version: 4,
        migrate: (state) =>
          cleanupLegacyLCSchedulerDatabases(
            normalizeDatabasePersistedState(state, fromVersion),
          ),
      },
      {
        version: 5,
        migrate: (state) =>
          normalizeLCReferenceDatabases(
            cleanupLegacyLCSchedulerDatabases(
              normalizeDatabasePersistedState(state, fromVersion),
            ),
          ),
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
