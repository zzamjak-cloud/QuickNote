// LC 워크스페이스 전용 "피처" 보호 DB — 작업·마일스톤 DB와 연동되는 고정 DB.

import type { ColumnDef, DatabaseBundle } from "../../types/database";
import { resolveLCSchedulerWorkspaceId } from "./scope";
import {
  LC_FEATURE_DATABASE_ID_PREFIX,
  LC_FEATURE_DATABASE_TITLE,
  LC_FEATURE_DATABASE_ID,
  LC_MILESTONE_DATABASE_ID,
  LC_SCHEDULER_DATABASE_ID,
  LC_SCHEDULER_COLUMN_IDS,
  LC_SCHEDULER_SEED_TIMESTAMP_MS,
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

export function makeLCFeatureDatabaseId(workspaceId: string): string {
  return `${LC_FEATURE_DATABASE_ID_PREFIX}${workspaceId}`;
}


function lcFeatureColumns(): ColumnDef[] {
  return [
    { id: LC_FEATURE_COLUMN_IDS.title, name: "피처", type: "title", width: 200 },
    {
      id: LC_FEATURE_COLUMN_IDS.milestone,
      name: "마일스톤",
      type: "pageLink",
      width: 180,
      config: {
        pageLinkScopeDatabaseId: LC_MILESTONE_DATABASE_ID,
      },
    },
    {
      id: LC_FEATURE_COLUMN_IDS.organization,
      name: "조직",
      type: "select",
      width: 140,
      config: {
        sourceFromDb: {
          databaseId: LC_MILESTONE_DATABASE_ID,
          columnId: LC_MILESTONE_COLUMN_IDS.organization,
          automation: true,
          viaPageLinkColumnId: LC_FEATURE_COLUMN_IDS.milestone,
        },
      },
    },
    {
      id: LC_FEATURE_COLUMN_IDS.team,
      name: "팀",
      type: "select",
      width: 140,
      config: {
        sourceFromDb: {
          databaseId: LC_MILESTONE_DATABASE_ID,
          columnId: LC_MILESTONE_COLUMN_IDS.team,
          automation: true,
          viaPageLinkColumnId: LC_FEATURE_COLUMN_IDS.milestone,
        },
      },
    },
    {
      id: LC_FEATURE_COLUMN_IDS.project,
      name: "프로젝트",
      type: "select",
      width: 140,
      config: {
        sourceFromDb: {
          databaseId: LC_MILESTONE_DATABASE_ID,
          columnId: LC_MILESTONE_COLUMN_IDS.project,
          automation: true,
          viaPageLinkColumnId: LC_FEATURE_COLUMN_IDS.milestone,
        },
      },
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
    { id: LC_FEATURE_COLUMN_IDS.workStart, name: "작업 기간", type: "date", width: 130 },
    {
      id: LC_FEATURE_COLUMN_IDS.task,
      name: "작업",
      type: "itemFetch",
      width: 200,
      config: {
        itemFetchSourceDatabaseId: LC_SCHEDULER_DATABASE_ID,
        itemFetchMatchColumnId: LC_SCHEDULER_COLUMN_IDS.feature,
      },
    },
  ];
}

function featureSourceConfig(columnId: keyof Pick<typeof LC_MILESTONE_COLUMN_IDS, "organization" | "team" | "project">) {
  return {
    databaseId: LC_MILESTONE_DATABASE_ID,
    columnId: LC_MILESTONE_COLUMN_IDS[columnId],
    automation: true,
    viaPageLinkColumnId: LC_FEATURE_COLUMN_IDS.milestone,
  };
}

function withSourceFromMilestone(
  column: ColumnDef,
  sourceColumnId: keyof Pick<typeof LC_MILESTONE_COLUMN_IDS, "organization" | "team" | "project">,
  legacyLinkedScope: "organization" | "team" | "project",
): ColumnDef {
  if (column.config?.sourceFromDb) return column;
  if (column.config?.linkedScope !== legacyLinkedScope) return column;
  const { linkedScope: _linkedScope, ...restConfig } = column.config ?? {};
  return {
    ...column,
    config: {
      ...restConfig,
      sourceFromDb: featureSourceConfig(sourceColumnId),
    },
  };
}

export function normalizeLCFeatureColumns(columns: ColumnDef[]): { columns: ColumnDef[]; changed: boolean } {
  let changed = false;
  const nextColumns = columns.flatMap((column) => {
    if (column.id === LC_FEATURE_COLUMN_IDS.workEnd) {
      changed = true;
      return [];
    }
    if (column.id === LC_FEATURE_COLUMN_IDS.workStart && column.name !== "작업 기간") {
      changed = true;
      return [{ ...column, name: "작업 기간" }];
    }
    let next = column;
    if (
      column.id === LC_FEATURE_COLUMN_IDS.milestone &&
      column.type === "pageLink" &&
      !column.config?.pageLinkScopeDatabaseId
    ) {
      next = {
        ...column,
        config: {
          ...(column.config ?? {}),
          pageLinkScopeDatabaseId: LC_MILESTONE_DATABASE_ID,
        },
      };
    } else if (column.id === LC_FEATURE_COLUMN_IDS.organization && column.type === "select") {
      next = withSourceFromMilestone(column, "organization", "organization");
    } else if (column.id === LC_FEATURE_COLUMN_IDS.team && column.type === "select") {
      next = withSourceFromMilestone(column, "team", "team");
    } else if (column.id === LC_FEATURE_COLUMN_IDS.project && column.type === "select") {
      next = withSourceFromMilestone(column, "project", "project");
    } else if (column.id === LC_FEATURE_COLUMN_IDS.task && column.type === "pageLink") {
      next = {
        ...column,
        type: "itemFetch",
        config: {
          itemFetchSourceDatabaseId: LC_SCHEDULER_DATABASE_ID,
          itemFetchMatchColumnId: LC_SCHEDULER_COLUMN_IDS.feature,
        },
      };
    }
    if (next !== column) changed = true;
    return [next];
  });
  return { columns: nextColumns, changed };
}

export async function ensureLCFeatureDatabase(workspaceId: string): Promise<void> {
  const [{ useDatabaseStore }, { enqueueUpsertDatabase }] = await Promise.all([
    import("../../store/databaseStore"),
    import("../../store/databaseStore/helpers"),
  ]);
  const schedulerWorkspaceId = resolveLCSchedulerWorkspaceId(workspaceId);
  const databaseId = makeLCFeatureDatabaseId(schedulerWorkspaceId);
  const existing = useDatabaseStore.getState().databases[databaseId];
  if (existing) {
    const normalized = normalizeLCFeatureColumns(existing.columns);
    if (!normalized.changed) return;
    const next: DatabaseBundle = {
      ...existing,
      columns: normalized.columns,
      meta: { ...existing.meta, updatedAt: Date.now() },
    };
    useDatabaseStore.setState((s) => ({
      ...s,
      databases: { ...s.databases, [databaseId]: next },
    }));
    enqueueUpsertDatabase(next);
    return;
  }

  // 고정 과거 타임스탬프로 시드 → 사용자 편집(updatedAt=now)이 항상 LWW 에서 이긴다.
  const t = LC_SCHEDULER_SEED_TIMESTAMP_MS;
  const next: DatabaseBundle = {
    meta: {
      id: databaseId,
      workspaceId: schedulerWorkspaceId,
      title: LC_FEATURE_DATABASE_TITLE,
      createdAt: t,
      updatedAt: t,
    },
    columns: lcFeatureColumns(),
    presets: [],
    rowPageOrder: [],
  };

  useDatabaseStore.setState((s) => ({
    ...s,
    databases: { ...s.databases, [databaseId]: next },
  }));
  enqueueUpsertDatabase(next);
}

export { LC_FEATURE_DATABASE_ID, LC_FEATURE_DATABASE_TITLE };
