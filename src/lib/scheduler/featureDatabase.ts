// LC 워크스페이스 전용 "피처" 보호 DB — 작업·마일스톤 DB와 연동되는 고정 DB.

import type { ColumnDef, DatabaseBundle } from "../../types/database";
import { resolveLCSchedulerWorkspaceId, LC_SCHEDULER_WORKSPACE_ID } from "./scope";
import {
  LC_FEATURE_DATABASE_ID_PREFIX,
  LC_FEATURE_DATABASE_TITLE,
  LC_FEATURE_DATABASE_ID,
  LC_MILESTONE_DATABASE_ID,
  syncFullPageTitleForDatabase,
} from "./database";
// (마일스톤 컬럼 sourceFromDb 미러링은 linkedScope 패턴으로 대체됨 — import 불필요)

export const LC_FEATURE_COLUMN_IDS = {
  title: "lc-feature:title",
  milestone: "lc-feature:milestone",
  organization: "lc-feature:organization",
  team: "lc-feature:team",
  project: "lc-feature:project",
  status: "lc-feature:status",
  importance: "lc-feature:importance",
  motive: "lc-feature:motive",
  progress: "lc-feature:progress",
  workStart: "lc-feature:workStart",
  workEnd: "lc-feature:workEnd",
  task: "lc-feature:task",
} as const;

export const LC_FEATURE_REQUIRED_COLUMN_IDS = new Set<string>([
  LC_FEATURE_COLUMN_IDS.title,
  LC_FEATURE_COLUMN_IDS.status,
]);

export function makeLCFeatureDatabaseId(workspaceId: string): string {
  return `${LC_FEATURE_DATABASE_ID_PREFIX}${workspaceId}`;
}

export function isLCFeatureRequiredColumnId(columnId: string): boolean {
  return LC_FEATURE_REQUIRED_COLUMN_IDS.has(columnId);
}

function lcFeatureColumns(): ColumnDef[] {
  return [
    { id: LC_FEATURE_COLUMN_IDS.title, name: "피처", type: "title", width: 200 },
    {
      id: LC_FEATURE_COLUMN_IDS.milestone,
      name: "마일스톤",
      type: "pageLink",
      width: 180,
      // 마일스톤 DB의 항목만 검색 대상으로 제한.
      config: { pageLinkScopeDatabaseId: LC_MILESTONE_DATABASE_ID },
    },
    {
      id: LC_FEATURE_COLUMN_IDS.organization,
      name: "조직",
      type: "select",
      width: 140,
      config: { linkedScope: "organization" },
    },
    {
      id: LC_FEATURE_COLUMN_IDS.team,
      name: "팀",
      type: "select",
      width: 140,
      config: { linkedScope: "team" },
    },
    {
      id: LC_FEATURE_COLUMN_IDS.project,
      name: "프로젝트",
      type: "select",
      width: 140,
      config: { linkedScope: "project" },
    },
    {
      id: LC_FEATURE_COLUMN_IDS.status,
      name: "상태",
      type: "status",
      width: 130,
      config: {
        options: [
          { id: "hold", label: "보류", color: "#94a3b8" },
          { id: "todo", label: "시작전", color: "#64748b" },
          { id: "progress", label: "진행중", color: "#3b82f6" },
          { id: "qa", label: "QA 가능", color: "#a855f7" },
          { id: "release", label: "출시가능", color: "#f59e0b" },
          { id: "done", label: "완료", color: "#10b981" },
        ],
      },
    },
    {
      id: LC_FEATURE_COLUMN_IDS.importance,
      name: "중요도",
      type: "select",
      width: 130,
      config: {
        options: [
          { id: "1.시급", label: "1.시급", color: "#ef4444" },
          { id: "2.필수", label: "2.필수", color: "#f59e0b" },
          { id: "3.있음좋음", label: "3.있음좋음", color: "#3b82f6" },
          { id: "4.애매함", label: "4.애매함", color: "#94a3b8" },
        ],
      },
    },
    {
      id: LC_FEATURE_COLUMN_IDS.motive,
      name: "계기",
      type: "multiSelect",
      width: 160,
      config: {
        options: [
          { id: "팀", label: "팀", color: "#3b82f6" },
          { id: "지표", label: "지표", color: "#10b981" },
          { id: "유저", label: "유저", color: "#f59e0b" },
          { id: "사업", label: "사업", color: "#a855f7" },
          { id: "LC", label: "LC", color: "#ef4444" },
        ],
      },
    },
    {
      id: LC_FEATURE_COLUMN_IDS.progress,
      name: "진행률",
      type: "progress",
      width: 160,
      // progressSource는 사용자가 직접 지정 (예: 작업 DB의 상태=완료 비율).
    },
    { id: LC_FEATURE_COLUMN_IDS.workStart, name: "작업시작", type: "date", width: 130 },
    { id: LC_FEATURE_COLUMN_IDS.workEnd, name: "작업종료", type: "date", width: 130 },
    {
      id: LC_FEATURE_COLUMN_IDS.task,
      name: "작업",
      type: "pageLink",
      width: 200,
      // 작업 DB 행만 검색 대상. 실제 작업 DB id는 워크스페이스별로 다르므로
      // 컬럼 편집에서 사용자가 지정하거나 후속 부트스트랩이 채워야 한다.
    },
  ];
}

function mergeFeatureColumns(existing: ColumnDef[] | undefined): ColumnDef[] {
  const required = lcFeatureColumns();
  const byId = new Map((existing ?? []).map((c) => [c.id, c]));
  const merged = required.map((col) => {
    const prev = byId.get(col.id);
    if (!prev) return col;
    return {
      ...col,
      ...prev,
      type: col.type,
      config: {
        ...(col.config ?? {}),
        ...(prev.config ?? {}),
      },
    };
  });
  const requiredIds = new Set(required.map((c) => c.id));
  for (const col of existing ?? []) {
    if (!requiredIds.has(col.id)) merged.push(col);
  }
  return merged;
}

export async function ensureLCFeatureDatabase(workspaceId: string): Promise<void> {
  const [{ useDatabaseStore }, { usePageStore }, { enqueueUpsertDatabase, enqueueUpsertPageRaw }] = await Promise.all([
    import("../../store/databaseStore"),
    import("../../store/pageStore"),
    import("../../store/databaseStore/helpers"),
  ]);
  const schedulerWorkspaceId = resolveLCSchedulerWorkspaceId(workspaceId);
  const databaseId = makeLCFeatureDatabaseId(schedulerWorkspaceId);
  const t = Date.now();
  const state = useDatabaseStore.getState();
  const existing = state.databases[databaseId];
  const next: DatabaseBundle = {
    meta: {
      id: databaseId,
      title: LC_FEATURE_DATABASE_TITLE,
      createdAt: existing?.meta.createdAt ?? t,
      updatedAt: t,
    },
    columns: mergeFeatureColumns(existing?.columns),
    presets: existing?.presets ?? [],
    rowPageOrder: existing?.rowPageOrder ?? [],
  };

  const same =
    existing &&
    existing.meta.title === next.meta.title &&
    JSON.stringify(existing.columns) === JSON.stringify(next.columns);

  if (same) {
    useDatabaseStore.setState((s) =>
      schedulerWorkspaceId === LC_SCHEDULER_WORKSPACE_ID
        ? s
        : s.cacheWorkspaceId === schedulerWorkspaceId
          ? s
          : { ...s, cacheWorkspaceId: schedulerWorkspaceId },
    );
    syncFullPageTitleForDatabase(databaseId, LC_FEATURE_DATABASE_TITLE, usePageStore, enqueueUpsertPageRaw);
    return;
  }

  useDatabaseStore.setState((s) => ({
    ...s,
    databases: { ...s.databases, [databaseId]: next },
  }));
  enqueueUpsertDatabase(next);
  syncFullPageTitleForDatabase(databaseId, LC_FEATURE_DATABASE_TITLE, usePageStore, enqueueUpsertPageRaw);
}

export { LC_FEATURE_DATABASE_ID, LC_FEATURE_DATABASE_TITLE };
