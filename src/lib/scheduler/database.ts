import type { ColumnDef, DatabaseBundle, DatabaseRowPreset } from "../../types/database";

export const LC_SCHEDULER_DATABASE_ID_PREFIX = "lc-scheduler-db:";
export const LC_SCHEDULER_DATABASE_TITLE = "LC스케줄러";

export const LC_SCHEDULER_COLUMN_IDS = {
  title: "lc-scheduler:title",
  assignees: "lc-scheduler:assignees",
  period: "lc-scheduler:period",
  project: "lc-scheduler:project",
  status: "lc-scheduler:status",
  organization: "lc-scheduler:organization",
  team: "lc-scheduler:team",
  milestone: "lc-scheduler:milestone",
  version: "lc-scheduler:version",
  feature: "lc-scheduler:feature",
  color: "lc-scheduler:color",
  meta: "lc-scheduler:meta",
} as const;

const LEGACY_REMOVED_COLUMN_IDS = new Set<string>([
  "lc-scheduler:estimateMm",
  "lc-scheduler:actualMm",
]);

export const LC_SCHEDULER_REQUIRED_COLUMN_IDS = new Set<string>([
  LC_SCHEDULER_COLUMN_IDS.title,
  LC_SCHEDULER_COLUMN_IDS.assignees,
  LC_SCHEDULER_COLUMN_IDS.period,
  LC_SCHEDULER_COLUMN_IDS.project,
  LC_SCHEDULER_COLUMN_IDS.status,
  LC_SCHEDULER_COLUMN_IDS.color,
  LC_SCHEDULER_COLUMN_IDS.meta,
]);

export function makeLCSchedulerDatabaseId(workspaceId: string): string {
  return `${LC_SCHEDULER_DATABASE_ID_PREFIX}${workspaceId}`;
}

export function isLCSchedulerDatabaseId(databaseId: string | null | undefined): boolean {
  return Boolean(databaseId?.startsWith(LC_SCHEDULER_DATABASE_ID_PREFIX));
}

export function getLCSchedulerWorkspaceIdFromDatabaseId(databaseId: string): string | null {
  if (!isLCSchedulerDatabaseId(databaseId)) return null;
  return databaseId.slice(LC_SCHEDULER_DATABASE_ID_PREFIX.length) || null;
}

export function isLCSchedulerScope(
  workspaceId: string | null | undefined,
  databaseId?: string | null,
): boolean {
  if (!workspaceId) return false;
  if (!databaseId) return false;
  return getLCSchedulerWorkspaceIdFromDatabaseId(databaseId) === workspaceId;
}

export function isLCSchedulerRequiredColumnId(columnId: string): boolean {
  return LC_SCHEDULER_REQUIRED_COLUMN_IDS.has(columnId);
}

export function isLCSchedulerHiddenPropertyColumnId(columnId: string): boolean {
  return columnId === LC_SCHEDULER_COLUMN_IDS.meta;
}

function lcSchedulerColumns(): ColumnDef[] {
  return [
    { id: LC_SCHEDULER_COLUMN_IDS.title, name: "작업명", type: "title", width: 220 },
    { id: LC_SCHEDULER_COLUMN_IDS.assignees, name: "작업자", type: "person", width: 180 },
    {
      id: LC_SCHEDULER_COLUMN_IDS.period,
      name: "기간",
      type: "date",
      width: 150,
      config: { dateShowEnd: true },
    },
    {
      id: LC_SCHEDULER_COLUMN_IDS.project,
      name: "프로젝트",
      type: "select",
      width: 150,
      config: { options: [] },
    },
    {
      id: LC_SCHEDULER_COLUMN_IDS.status,
      name: "상태",
      type: "status",
      width: 130,
      config: {
        options: [
          { id: "todo", label: "시작전", color: "#94a3b8" },
          { id: "progress", label: "진행중", color: "#3b82f6" },
          { id: "done", label: "완료", color: "#10b981" },
          { id: "hold", label: "보류", color: "#f59e0b" },
          { id: "leave", label: "연차", color: "#e74c3c" },
        ],
      },
    },
    { id: LC_SCHEDULER_COLUMN_IDS.organization, name: "조직", type: "select", width: 140, config: { options: [] } },
    { id: LC_SCHEDULER_COLUMN_IDS.team, name: "팀", type: "select", width: 140, config: { options: [] } },
    { id: LC_SCHEDULER_COLUMN_IDS.milestone, name: "마일스톤", type: "select", width: 140, config: { options: [] } },
    { id: LC_SCHEDULER_COLUMN_IDS.version, name: "버전", type: "text", width: 120 },
    { id: LC_SCHEDULER_COLUMN_IDS.feature, name: "피쳐", type: "text", width: 160 },
    {
      id: LC_SCHEDULER_COLUMN_IDS.color,
      name: "카드 색상",
      type: "select",
      width: 130,
      config: {
        options: [
          { id: "#3498DB", label: "파랑", color: "#3498DB" },
          { id: "#2ECC71", label: "초록", color: "#2ECC71" },
          { id: "#F1C40F", label: "노랑", color: "#F1C40F" },
          { id: "#E67E22", label: "주황", color: "#E67E22" },
          { id: "#9B59B6", label: "보라", color: "#9B59B6" },
          { id: "#E74C3C", label: "빨강", color: "#E74C3C" },
        ],
      },
    },
    { id: LC_SCHEDULER_COLUMN_IDS.meta, name: "스케줄러 메타", type: "json", width: 220 },
  ];
}

function defaultPresets(databaseId: string, t: number): DatabaseRowPreset[] {
  const visibleColumnIds = [
    LC_SCHEDULER_COLUMN_IDS.title,
    LC_SCHEDULER_COLUMN_IDS.assignees,
    LC_SCHEDULER_COLUMN_IDS.period,
    LC_SCHEDULER_COLUMN_IDS.project,
    LC_SCHEDULER_COLUMN_IDS.status,
  ];
  const hiddenColumnIds = [
    LC_SCHEDULER_COLUMN_IDS.organization,
    LC_SCHEDULER_COLUMN_IDS.team,
    LC_SCHEDULER_COLUMN_IDS.milestone,
    LC_SCHEDULER_COLUMN_IDS.version,
    LC_SCHEDULER_COLUMN_IDS.feature,
    LC_SCHEDULER_COLUMN_IDS.color,
    LC_SCHEDULER_COLUMN_IDS.meta,
  ];

  return [
    {
      id: "lc-scheduler-preset:task",
      databaseId,
      name: "일정",
      scope: "workspace",
      columnDefaults: {
        [LC_SCHEDULER_COLUMN_IDS.status]: "todo",
        [LC_SCHEDULER_COLUMN_IDS.color]: "#3498DB",
        [LC_SCHEDULER_COLUMN_IDS.meta]: { kind: "schedule" },
      },
      requiredColumnIds: visibleColumnIds,
      visibleColumnIds,
      hiddenColumnIds,
      schedulerDefaults: { durationDays: 1, color: "#3498DB" },
      createdAt: t,
      updatedAt: t,
    },
    {
      id: "lc-scheduler-preset:annual-leave",
      databaseId,
      name: "연차",
      scope: "workspace",
      columnDefaults: {
        [LC_SCHEDULER_COLUMN_IDS.title]: "연차",
        [LC_SCHEDULER_COLUMN_IDS.status]: "leave",
        [LC_SCHEDULER_COLUMN_IDS.color]: "#E74C3C",
        [LC_SCHEDULER_COLUMN_IDS.meta]: { kind: "leave", annualLeave: true },
      },
      requiredColumnIds: visibleColumnIds,
      visibleColumnIds,
      hiddenColumnIds,
      schedulerDefaults: { durationDays: 1, color: "#E74C3C", titlePrefix: "연차" },
      createdAt: t,
      updatedAt: t,
    },
  ];
}

function mergeColumns(existing: ColumnDef[] | undefined): ColumnDef[] {
  const required = lcSchedulerColumns();
  const byId = new Map((existing ?? []).map((column) => [column.id, column]));
  const merged = required.map((column) => {
    const prev = byId.get(column.id);
    if (!prev) return column;
    return {
      ...column,
      ...prev,
      type: column.type,
      config: prev.config ?? column.config,
    };
  });
  const requiredIds = new Set(required.map((column) => column.id));
  for (const column of existing ?? []) {
    if (LEGACY_REMOVED_COLUMN_IDS.has(column.id)) continue;
    if (!requiredIds.has(column.id)) merged.push(column);
  }
  return merged;
}

function sanitizePreset(preset: DatabaseRowPreset): DatabaseRowPreset {
  const columnDefaults = { ...(preset.columnDefaults ?? {}) };
  for (const id of LEGACY_REMOVED_COLUMN_IDS) {
    delete columnDefaults[id];
  }
  const filterIds = (ids: string[]) => ids.filter((id) => !LEGACY_REMOVED_COLUMN_IDS.has(id));
  return {
    ...preset,
    columnDefaults,
    requiredColumnIds: filterIds(preset.requiredColumnIds ?? []),
    visibleColumnIds: filterIds(preset.visibleColumnIds ?? []),
    hiddenColumnIds: filterIds(preset.hiddenColumnIds ?? []),
  };
}

function mergePresets(
  databaseId: string,
  existing: DatabaseRowPreset[] | undefined,
  t: number,
): DatabaseRowPreset[] {
  const presets = [...(existing ?? [])].map(sanitizePreset);
  const existingIds = new Set(presets.map((preset) => preset.id));
  for (const preset of defaultPresets(databaseId, t)) {
    if (!existingIds.has(preset.id)) presets.push(preset);
  }
  return presets.map((preset) => ({ ...preset, databaseId }));
}

export async function ensureLCSchedulerDatabase(workspaceId: string): Promise<void> {
  const [{ useDatabaseStore }, { enqueueUpsertDatabase }] = await Promise.all([
    import("../../store/databaseStore"),
    import("../../store/databaseStore/helpers"),
  ]);
  const databaseId = makeLCSchedulerDatabaseId(workspaceId);
  const t = Date.now();
  const state = useDatabaseStore.getState();
  const existing = state.databases[databaseId];
  const next: DatabaseBundle = {
    meta: {
      id: databaseId,
      title: LC_SCHEDULER_DATABASE_TITLE,
      createdAt: existing?.meta.createdAt ?? t,
      updatedAt: t,
    },
    columns: mergeColumns(existing?.columns),
    presets: mergePresets(databaseId, existing?.presets, t),
    rowPageOrder: existing?.rowPageOrder ?? [],
  };

  const same =
    existing &&
    existing.meta.title === next.meta.title &&
    JSON.stringify(existing.columns) === JSON.stringify(next.columns) &&
    JSON.stringify(existing.presets ?? []) === JSON.stringify(next.presets ?? []);

  if (same) {
    useDatabaseStore.setState((s) =>
      s.cacheWorkspaceId === workspaceId ? s : { ...s, cacheWorkspaceId: workspaceId },
    );
    return;
  }

  useDatabaseStore.setState((s) => ({
    ...s,
    databases: { ...s.databases, [databaseId]: next },
    cacheWorkspaceId: workspaceId,
  }));
  enqueueUpsertDatabase(next);
}
