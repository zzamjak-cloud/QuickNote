// LC 워크스페이스 전용 "피처" 보호 DB — 작업·마일스톤 DB와 연동되는 고정 DB.

import type { ColumnDef, DatabaseBundle } from "../../types/database";
import { resolveLCSchedulerWorkspaceId, LC_SCHEDULER_WORKSPACE_ID } from "./scope";
import {
  LC_FEATURE_DATABASE_ID_PREFIX,
  LC_FEATURE_DATABASE_TITLE,
  LC_FEATURE_DATABASE_ID,
  LC_MILESTONE_DATABASE_ID,
  LC_SCHEDULER_DATABASE_ID,
  LC_SCHEDULER_COLUMN_IDS,
  syncFullPageTitleForDatabase,
} from "./database";
import { LC_MILESTONE_COLUMN_IDS } from "./milestoneDatabase";
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
      // 마일스톤 DB 항목만 검색 대상 + 마일스톤 선택 시 조직·팀·프로젝트 자동 채움.
      config: {
        pageLinkScopeDatabaseId: LC_MILESTONE_DATABASE_ID,
        pageLinkAutoFill: [
          { targetColumnId: LC_FEATURE_COLUMN_IDS.organization, sourceColumnId: LC_MILESTONE_COLUMN_IDS.organization },
          { targetColumnId: LC_FEATURE_COLUMN_IDS.team, sourceColumnId: LC_MILESTONE_COLUMN_IDS.team },
          { targetColumnId: LC_FEATURE_COLUMN_IDS.project, sourceColumnId: LC_MILESTONE_COLUMN_IDS.project },
        ],
      },
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
      // 작업 DB에서 이 피처와 연결된 작업들의 상태(done) 비율로 자동 계산.
      config: {
        progressSource: {
          databaseId: LC_SCHEDULER_DATABASE_ID,
          columnId: LC_SCHEDULER_COLUMN_IDS.status,
          completedValue: "done",
          scope: {
            mode: "linkedPagesFromColumn" as const,
            pageLinkColumnId: LC_FEATURE_COLUMN_IDS.task,
          },
        },
      },
    },
    { id: LC_FEATURE_COLUMN_IDS.workStart, name: "작업시작", type: "date", width: 130 },
    { id: LC_FEATURE_COLUMN_IDS.workEnd, name: "작업종료", type: "date", width: 130 },
    {
      id: LC_FEATURE_COLUMN_IDS.task,
      name: "작업",
      type: "pageLink",
      width: 200,
      // 작업 DB의 "피쳐" pageLink 컬럼이 변경될 때 자동으로 채워지는 역방향 컬럼.
      // 사용자가 직접 수정할 수 없도록 pageLinkAutoReverse: true 설정.
      config: {
        pageLinkScopeDatabaseId: LC_SCHEDULER_DATABASE_ID,
        pageLinkAutoReverse: true,
      },
    },
  ];
}

function mergeFeatureColumnConfig(
  colConfig: ColumnDef["config"] | undefined,
  prevConfig: ColumnDef["config"] | undefined,
): ColumnDef["config"] | undefined {
  // 기본: 기존 값(prev) 우선. 단, 시스템 제어 필드는 defaults(col) 우선
  // — 구버전 캐시의 잔류 값이 새 자동화 설정을 덮지 않도록.
  const merged = { ...(colConfig ?? {}), ...(prevConfig ?? {}) };
  if (colConfig?.pageLinkScopeDatabaseId !== undefined) {
    merged.pageLinkScopeDatabaseId = colConfig.pageLinkScopeDatabaseId;
  }
  if (colConfig?.pageLinkAutoReverse !== undefined) {
    merged.pageLinkAutoReverse = colConfig.pageLinkAutoReverse;
  }
  if (colConfig?.pageLinkAutoFill !== undefined) {
    merged.pageLinkAutoFill = colConfig.pageLinkAutoFill;
  }
  if (colConfig?.progressSource !== undefined) {
    merged.progressSource = colConfig.progressSource;
  }
  if (colConfig?.linkedScope !== undefined) {
    merged.linkedScope = colConfig.linkedScope;
  }
  if (prevConfig?.sourceFromDb) {
    delete merged.linkedScope;
    merged.sourceFromDb = prevConfig.sourceFromDb;
  }
  return Object.keys(merged).length ? merged : undefined;
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
      config: mergeFeatureColumnConfig(col.config, prev.config),
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
      workspaceId: LC_SCHEDULER_WORKSPACE_ID,
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
