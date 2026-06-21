// 원격 Database 엔티티를 database 스토어에 LWW 적용하는 reducer.
// storeApply.ts 에서 분리(behavior-preserving).
import type { GqlDatabase } from "../graphql/operations";
import { useDatabaseStore } from "../../../store/databaseStore";
import type { CellValue, DatabaseBundle, DatabasePanelState, DatabaseTemplate } from "../../../types/database";
import { repairDbHistoryBaselineIfNeeded } from "../../../store/historyStore";
import { enqueueAsync } from "../runtime";
import {
  createLocalDeleteGuardChecker,
  shouldIgnoreRemoteAfterLocalDelete,
} from "../localDeleteGuards";
import {
  LC_SCHEDULER_DATABASE_ID,
  LC_SCHEDULER_DATABASE_TITLE,
  isLCSchedulerDatabaseId,
  isLegacyLCSchedulerDatabaseId,
  isProtectedDatabaseId,
} from "../../scheduler/database";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../scheduler/scope";
import {
  tryParseSerializedColumns,
  tryParseSerializedPanelState,
  tryParseSerializedPresets,
} from "../../database/schema/normalizeDatabase";
import { normalizeTemplateAutomationConfig } from "../../database/templateAutomation";
import {
  isoToMs,
  isRemoteNewer,
  stringArrayEqual,
  mergeRowPageOrderWithDerived,
} from "./helpers";
import { shouldApplyRemoteSnapshot, resolveNextCacheWorkspaceId } from "./applyShared";
import {
  collectRowPageIdsForDatabase,
  collectRowPageIdsForDatabases,
} from "./rowOrder";

function parseRemoteDatabaseSchema(
  db: GqlDatabase,
): (Pick<DatabaseBundle, "columns" | "presets" | "panelState"> & {
  templates?: DatabaseTemplate[];
}) | null {
  const columns = tryParseSerializedColumns(db.columns);
  const presets = tryParseSerializedPresets(db.presets);
  const panelState = tryParseSerializedPanelState(db.panelState);
  const templates = parseRemoteDatabaseTemplates(db.templates);
  if (!columns || !presets) {
    console.warn("[sync] storeApply: invalid database schema ignored", {
      databaseId: db.id,
      columnsOk: Boolean(columns),
      presetsOk: Boolean(presets),
      rawColumns: db.columns,
      rawPresets: db.presets,
    });
    return null;
  }
  if (db.panelState != null && !panelState) {
    console.warn("[sync] storeApply: invalid database panelState ignored", {
      databaseId: db.id,
    });
  }
  return {
    columns,
    presets,
    ...(panelState ? { panelState } : {}),
    ...(templates !== undefined ? { templates } : {}),
  };
}

function parseRemoteDatabaseTemplates(raw: unknown): DatabaseTemplate[] | undefined {
  if (raw == null || raw === "") return undefined;
  let parsed: unknown = raw;
  for (let depth = 0; depth < 2 && typeof parsed === "string"; depth += 1) {
    if (parsed === "") return undefined;
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return undefined;
    }
  }
  if (!Array.isArray(parsed)) {
    return undefined;
  }
  const templates: DatabaseTemplate[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.title !== "string") continue;
    const cells =
      record.cells && typeof record.cells === "object" && !Array.isArray(record.cells)
        ? (record.cells as Record<string, CellValue>)
        : {};
    const automation = normalizeTemplateAutomationConfig(record.automation, `${record.id}:automation`);
    templates.push({
      id: record.id,
      title: record.title,
      cells,
      ...(typeof record.pageId === "string" ? { pageId: record.pageId } : {}),
      ...(automation ? { automation } : {}),
    });
  }
  return templates;
}

function mergeRemoteSchedulerMemberOrder(
  localPanelState: DatabasePanelState | undefined,
  remotePanelState: DatabasePanelState | undefined,
): DatabasePanelState | undefined {
  const remoteOrder = remotePanelState?.schedulerMemberOrder;
  if (!remoteOrder) return localPanelState;

  const localOrder = localPanelState?.schedulerMemberOrder ?? [];
  const remoteUpdatedAt = remotePanelState.schedulerMemberOrderUpdatedAt ?? 0;
  const localUpdatedAt = localPanelState?.schedulerMemberOrderUpdatedAt ?? 0;
  const remoteWins =
    remoteUpdatedAt > localUpdatedAt ||
    (remoteUpdatedAt === localUpdatedAt && !stringArrayEqual(remoteOrder, localOrder));
  if (!remoteWins) return localPanelState;

  return {
    ...(localPanelState ?? remotePanelState),
    schedulerMemberOrder: [...remoteOrder],
    schedulerMemberOrderUpdatedAt: remoteUpdatedAt,
  };
}

function resolvePanelStateWithLocalFallback(
  localPanelState: DatabasePanelState | undefined,
  remotePanelState: DatabasePanelState | undefined,
): DatabasePanelState | undefined {
  // 서버가 빈 panelState({})로 잘못 덮인 경우(과거 회귀로 탭 유실), local 에 탭이 있으면 보존한다.
  const remoteHasPresets = (remotePanelState?.filterPresets?.length ?? 0) > 0;
  const localHasPresets = (localPanelState?.filterPresets?.length ?? 0) > 0;
  const resolvedPanelState =
    remoteHasPresets || !localHasPresets ? (remotePanelState ?? localPanelState) : localPanelState;

  return mergeRemoteSchedulerMemberOrder(resolvedPanelState, remotePanelState);
}

function mergeRemoteSchedulerMemberOrderIntoLocalDatabase(
  db: GqlDatabase,
  local: DatabaseBundle | undefined,
  schema: Pick<DatabaseBundle, "columns" | "presets" | "panelState"> | null,
): boolean {
  if (!local || db.id !== LC_SCHEDULER_DATABASE_ID || !schema?.panelState) return false;
  const nextPanelState = mergeRemoteSchedulerMemberOrder(local.panelState, schema.panelState);
  if (nextPanelState === local.panelState) return false;

  useDatabaseStore.setState((s) => {
    const bundle = s.databases[db.id];
    if (!bundle) return s;
    return {
      ...s,
      databases: {
        ...s.databases,
        [db.id]: {
          ...bundle,
          panelState: nextPanelState,
        },
      },
      cacheWorkspaceId: resolveNextCacheWorkspaceId(s.cacheWorkspaceId, db.workspaceId),
    };
  });
  return true;
}

export function applyRemoteDatabaseToStore(
  d: GqlDatabase | null | undefined,
): void {
  if (!d) return;
  const remote = d;
  if (isLegacyLCSchedulerDatabaseId(remote.id)) {
    useDatabaseStore.setState((s) => {
      if (!s.databases[remote.id]) return s;
      const rest = { ...s.databases };
      delete rest[remote.id];
      return { ...s, databases: rest };
    });
    return;
  }

  const normalizedDatabase = isLCSchedulerDatabaseId(remote.id)
    ? {
        ...remote,
        id: LC_SCHEDULER_DATABASE_ID,
        workspaceId: LC_SCHEDULER_WORKSPACE_ID,
        title: LC_SCHEDULER_DATABASE_TITLE,
      }
    : remote;
  // legacy LC 스케줄러 id(canonical 이 아닌 prefix 매치) 만 1회 재업서트해 마이그레이션한다.
  // 참조 비교(normalizedDatabase !== remote)는 canonical id 에도 항상 true 라 매 수신마다
  // 재업서트 → echo → 무한 루프를 만들었다. 값 기준(legacy 여부)으로 차단한다.
  if (isLegacyLCSchedulerDatabaseId(remote.id)) {
    queueMicrotask(() => {
      enqueueAsync("upsertDatabase", {
        id: normalizedDatabase.id,
        workspaceId: normalizedDatabase.workspaceId,
        createdByMemberId: normalizedDatabase.createdByMemberId,
        title: normalizedDatabase.title,
        columns: normalizedDatabase.columns,
        presets: normalizedDatabase.presets,
        panelState: normalizedDatabase.panelState,
        templates: normalizedDatabase.templates,
        createdAt: normalizedDatabase.createdAt,
        updatedAt: normalizedDatabase.updatedAt,
      });
    });
  }
  const db = normalizedDatabase;
  if (!shouldApplyRemoteSnapshot(db.workspaceId)) return;
  if (
    !db.deletedAt &&
    shouldIgnoreRemoteAfterLocalDelete("database", db.id, db.workspaceId, db.updatedAt)
  ) {
    return;
  }

  const local = useDatabaseStore.getState().databases[db.id];

  if (db.deletedAt) {
    if (isProtectedDatabaseId(db.id)) {
      useDatabaseStore.setState((s) =>
        s.cacheWorkspaceId === resolveNextCacheWorkspaceId(s.cacheWorkspaceId, db.workspaceId)
          ? s
          : { ...s, cacheWorkspaceId: resolveNextCacheWorkspaceId(s.cacheWorkspaceId, db.workspaceId) },
      );
      return;
    }
    useDatabaseStore.setState((s) => {
      const bundle = s.databases[db.id];
      if (!bundle) return s;
      const rest = { ...s.databases };
      const nextTemplates = { ...s.dbTemplates };
      delete rest[db.id];
      delete nextTemplates[db.id];
      return { ...s, databases: rest, dbTemplates: nextTemplates, cacheWorkspaceId: db.workspaceId };
    });
    return;
  }

  const schema = parseRemoteDatabaseSchema(db);
  if (!schema) return;

  if (local && !isRemoteNewer(local.meta.updatedAt, db.updatedAt)) {
    if (mergeRemoteSchedulerMemberOrderIntoLocalDatabase(db, local, schema)) return;
    useDatabaseStore.setState((s) =>
      s.cacheWorkspaceId === resolveNextCacheWorkspaceId(s.cacheWorkspaceId, db.workspaceId)
        ? s
        : { ...s, cacheWorkspaceId: resolveNextCacheWorkspaceId(s.cacheWorkspaceId, db.workspaceId) },
    );
    return;
  }

  const { columns, presets, panelState, templates } = schema;
  const derivedRowOrder = collectRowPageIdsForDatabase(db.id);
  const rowPageOrder = mergeRowPageOrderWithDerived(local?.rowPageOrder, derivedRowOrder);
  const resolvedPanelState = resolvePanelStateWithLocalFallback(local?.panelState, panelState);

  const bundle: DatabaseBundle = {
    meta: {
      id: db.id,
      workspaceId: db.workspaceId,
      title: db.title,
      createdAt: isoToMs(db.createdAt) || Date.now(),
      updatedAt: isoToMs(db.updatedAt) || Date.now(),
    },
    columns,
    presets,
    panelState: resolvedPanelState,
    rowPageOrder,
  };

  useDatabaseStore.setState((s) => ({
    ...s,
    databases: { ...s.databases, [db.id]: bundle },
    dbTemplates:
      templates !== undefined
        ? { ...s.dbTemplates, [db.id]: templates }
        : s.dbTemplates,
    cacheWorkspaceId: resolveNextCacheWorkspaceId(s.cacheWorkspaceId, db.workspaceId),
  }));
  repairDbHistoryBaselineIfNeeded(db.id, structuredClone(bundle));
}

export function applyRemoteDatabasesToStore(
  remoteDatabases: Array<GqlDatabase | null | undefined>,
): void {
  if (remoteDatabases.length === 0) return;
  const normalizedDatabases: GqlDatabase[] = [];
  const legacyDeleteIds = new Set<string>();
  const candidateDatabaseIds = new Set<string>();
  const shouldIgnoreLocalDelete = createLocalDeleteGuardChecker();

  for (const d of remoteDatabases) {
    if (!d) continue;
    if (isLegacyLCSchedulerDatabaseId(d.id)) {
      legacyDeleteIds.add(d.id);
      continue;
    }
    const normalizedDatabase = isLCSchedulerDatabaseId(d.id)
      ? {
          ...d,
          id: LC_SCHEDULER_DATABASE_ID,
          workspaceId: LC_SCHEDULER_WORKSPACE_ID,
          title: LC_SCHEDULER_DATABASE_TITLE,
        }
      : d;
    // legacy LC 스케줄러 id 만 1회 재업서트(참조 비교 무한 루프 차단 — 위 단건 경로와 동일).
    if (isLegacyLCSchedulerDatabaseId(d.id)) {
      queueMicrotask(() => {
        enqueueAsync("upsertDatabase", {
          id: normalizedDatabase.id,
          workspaceId: normalizedDatabase.workspaceId,
          createdByMemberId: normalizedDatabase.createdByMemberId,
          title: normalizedDatabase.title,
          columns: normalizedDatabase.columns,
          presets: normalizedDatabase.presets,
          templates: normalizedDatabase.templates,
          createdAt: normalizedDatabase.createdAt,
          updatedAt: normalizedDatabase.updatedAt,
        });
      });
    }
    if (!shouldApplyRemoteSnapshot(normalizedDatabase.workspaceId)) continue;
    if (
      !normalizedDatabase.deletedAt &&
      shouldIgnoreLocalDelete(
        "database",
        normalizedDatabase.id,
        normalizedDatabase.workspaceId,
        normalizedDatabase.updatedAt,
      )
    ) {
      continue;
    }
    normalizedDatabases.push(normalizedDatabase);
    if (!normalizedDatabase.deletedAt) candidateDatabaseIds.add(normalizedDatabase.id);
  }


  if (normalizedDatabases.length === 0 && legacyDeleteIds.size === 0) return;

  const derivedByDbId = collectRowPageIdsForDatabases(candidateDatabaseIds);
  const repairedBundles: DatabaseBundle[] = [];
  const databaseDebugRows: Array<Record<string, unknown>> = [];

  useDatabaseStore.setState((s) => {
    let databases = s.databases;
    let dbTemplates = s.dbTemplates;
    let nextCacheWorkspaceId = s.cacheWorkspaceId;
    let changed = false;

    const ensureDatabasesCopy = () => {
      if (databases === s.databases) databases = { ...s.databases };
    };
    const ensureTemplatesCopy = () => {
      if (dbTemplates === s.dbTemplates) dbTemplates = { ...s.dbTemplates };
    };

    for (const id of legacyDeleteIds) {
      if (!databases[id]) continue;
      ensureDatabasesCopy();
      ensureTemplatesCopy();
      delete databases[id];
      delete dbTemplates[id];
      databaseDebugRows.push({ databaseId: id, action: "legacy-delete" });
      changed = true;
    }

    for (const db of normalizedDatabases) {
      nextCacheWorkspaceId = resolveNextCacheWorkspaceId(nextCacheWorkspaceId, db.workspaceId);

      if (db.deletedAt) {
        if (isProtectedDatabaseId(db.id)) {
          databaseDebugRows.push({ databaseId: db.id, action: "delete-skip-protected" });
          continue;
        }
        if (!databases[db.id]) {
          databaseDebugRows.push({ databaseId: db.id, action: "delete-skip-missing-local" });
          continue;
        }
        ensureDatabasesCopy();
        ensureTemplatesCopy();
        delete databases[db.id];
        delete dbTemplates[db.id];
        databaseDebugRows.push({ databaseId: db.id, action: "delete" });
        changed = true;
        continue;
      }

      const schema = parseRemoteDatabaseSchema(db);
      if (!schema) {
        databaseDebugRows.push({ databaseId: db.id, action: "schema-invalid" });
        continue;
      }
      const local = databases[db.id];
      if (local && !isRemoteNewer(local.meta.updatedAt, db.updatedAt)) {
        const derived = derivedByDbId.get(db.id) ?? [];
        const rowPageOrder = mergeRowPageOrderWithDerived(local.rowPageOrder, derived);
        const nextPanelState =
          db.id === LC_SCHEDULER_DATABASE_ID
            ? mergeRemoteSchedulerMemberOrder(local.panelState, schema.panelState)
            : local.panelState;
        if (
          !stringArrayEqual(local.rowPageOrder, rowPageOrder) ||
          nextPanelState !== local.panelState
        ) {
          ensureDatabasesCopy();
          databases[db.id] = { ...local, panelState: nextPanelState, rowPageOrder };
          changed = true;
          databaseDebugRows.push({
            databaseId: db.id,
            workspaceId: db.workspaceId,
            action: "stale-repair",
            localUpdatedAt: local.meta.updatedAt,
            remoteUpdatedAt: db.updatedAt,
            localRowCount: local.rowPageOrder.length,
            derivedRowCount: derived.length,
            nextRowCount: rowPageOrder.length,
            panelStateChanged: nextPanelState !== local.panelState,
          });
        } else {
          databaseDebugRows.push({
            databaseId: db.id,
            workspaceId: db.workspaceId,
            action: "stale-skip",
            localUpdatedAt: local.meta.updatedAt,
            remoteUpdatedAt: db.updatedAt,
            localRowCount: local.rowPageOrder.length,
            derivedRowCount: derived.length,
          });
        }
        continue;
      }

      const { columns, presets, panelState, templates } = schema;
      const derivedRowOrder = derivedByDbId.get(db.id) ?? [];
      const rowPageOrder = mergeRowPageOrderWithDerived(local?.rowPageOrder, derivedRowOrder);
      // 단건 경로(applyRemoteDatabaseToStore)와 동일하게 panelState 를 반영해야 한다.
      // (과거 누락으로 전체 페치/새로고침 시 스케줄러 DB 의 표시설정·구성원 순서가 사라졌다.)
      const resolvedPanelState = resolvePanelStateWithLocalFallback(local?.panelState, panelState);
      const bundle: DatabaseBundle = {
        meta: {
          id: db.id,
          workspaceId: db.workspaceId,
          title: db.title,
          createdAt: isoToMs(db.createdAt) || Date.now(),
          updatedAt: isoToMs(db.updatedAt) || Date.now(),
        },
        columns,
        presets,
        panelState: resolvedPanelState,
        rowPageOrder,
      };

      ensureDatabasesCopy();
      databases[db.id] = bundle;
      if (templates !== undefined) {
        ensureTemplatesCopy();
        dbTemplates[db.id] = templates;
      }
      repairedBundles.push(bundle);
      databaseDebugRows.push({
        databaseId: db.id,
        workspaceId: db.workspaceId,
        action: local ? "upsert-newer" : "upsert-new-local",
        localUpdatedAt: local?.meta.updatedAt ?? null,
        remoteUpdatedAt: db.updatedAt,
        localRowCount: local?.rowPageOrder.length ?? null,
        derivedRowCount: derivedRowOrder.length,
        nextRowCount: rowPageOrder.length,
      });
      changed = true;
    }

    if (!changed && nextCacheWorkspaceId === s.cacheWorkspaceId) return s;
    return {
      ...s,
      databases,
      dbTemplates,
      cacheWorkspaceId: nextCacheWorkspaceId,
    };
  });

  for (const bundle of repairedBundles) {
    repairDbHistoryBaselineIfNeeded(bundle.meta.id, structuredClone(bundle));
  }
}
