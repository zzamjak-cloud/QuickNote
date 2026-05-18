import type { ColumnDef, DatabaseBundle, DatabaseRowPreset } from "../../types/database";
import { LC_SCHEDULER_WORKSPACE_ID, resolveLCSchedulerWorkspaceId } from "./scope";

export const LC_SCHEDULER_DATABASE_ID_PREFIX = "lc-scheduler-db:";
export const LC_SCHEDULER_DATABASE_TITLE = "LC스케줄러";
export const LC_SCHEDULER_DATABASE_ID = `${LC_SCHEDULER_DATABASE_ID_PREFIX}${LC_SCHEDULER_WORKSPACE_ID}`;
export const LC_SCHEDULER_TASK_PRESET_ID = "lc-scheduler-preset:task";
export const LC_SCHEDULER_ATTENDANCE_PRESET_ID = "lc-scheduler-preset:annual-leave";

export const LC_SCHEDULER_COLUMN_IDS = {
  title: "lc-scheduler:title",
  assignees: "lc-scheduler:assignees",
  period: "lc-scheduler:period",
  project: "lc-scheduler:project",
  status: "lc-scheduler:status",
  attendance: "lc-scheduler:attendance",
  organization: "lc-scheduler:organization",
  team: "lc-scheduler:team",
  milestone: "lc-scheduler:milestone",
  version: "lc-scheduler:version",
  feature: "lc-scheduler:feature",
  color: "lc-scheduler:color",
  meta: "lc-scheduler:meta",
} as const;

export const LC_SCHEDULER_ATTENDANCE_TITLE = "근태";

export const LC_SCHEDULER_ATTENDANCE_OPTIONS = [
  { id: "annual-leave", label: "연차", color: "#e74c3c", dayValue: 1 },
  { id: "morning-half-day", label: "오전반차", color: "#f97316", dayValue: 0.5 },
  { id: "afternoon-half-day", label: "오후반차", color: "#f59e0b", dayValue: 0.5 },
  { id: "morning-quarter-day", label: "오전반반차", color: "#a855f7", dayValue: 0.25 },
  { id: "afternoon-quarter-day", label: "오후반반차", color: "#8b5cf6", dayValue: 0.25 },
  { id: "hourly-leave-30m", label: "시간차(30분)", color: "#06b6d4", dayValue: 0.0625 },
  { id: "hourly-leave-1h", label: "시간차(1시간)", color: "#0891b2", dayValue: 0.125 },
  { id: "hourly-leave-90m", label: "시간차(1시간 30분)", color: "#0e7490", dayValue: 0.1875 },
] as const;

export type LCSchedulerAttendanceValue = typeof LC_SCHEDULER_ATTENDANCE_OPTIONS[number]["id"];

const LEGACY_ATTENDANCE_VALUE_MAP: Record<string, LCSchedulerAttendanceValue> = {
  "hourly-leave": "hourly-leave-1h",
};

export function normalizeLCSchedulerAttendanceValue(value: string | null | undefined): LCSchedulerAttendanceValue | null {
  if (!value) return null;
  if (LC_SCHEDULER_ATTENDANCE_OPTIONS.some((option) => option.id === value)) {
    return value as LCSchedulerAttendanceValue;
  }
  return LEGACY_ATTENDANCE_VALUE_MAP[value] ?? null;
}

export function isLCSchedulerAttendanceValue(value: string | null | undefined): value is LCSchedulerAttendanceValue {
  return LC_SCHEDULER_ATTENDANCE_OPTIONS.some((option) => option.id === value);
}

export function getLCSchedulerAttendanceLabel(value: string | null | undefined): string | null {
  const normalized = normalizeLCSchedulerAttendanceValue(value);
  return LC_SCHEDULER_ATTENDANCE_OPTIONS.find((option) => option.id === normalized)?.label ?? null;
}

export function getLCSchedulerAttendanceDayValue(value: string | null | undefined): number | null {
  const normalized = normalizeLCSchedulerAttendanceValue(value);
  return LC_SCHEDULER_ATTENDANCE_OPTIONS.find((option) => option.id === normalized)?.dayValue ?? null;
}

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
  LC_SCHEDULER_COLUMN_IDS.attendance,
  LC_SCHEDULER_COLUMN_IDS.color,
  LC_SCHEDULER_COLUMN_IDS.meta,
]);

export function makeLCSchedulerDatabaseId(workspaceId: string): string {
  return `${LC_SCHEDULER_DATABASE_ID_PREFIX}${workspaceId}`;
}

export function isLCSchedulerDatabaseId(databaseId: string | null | undefined): boolean {
  return Boolean(databaseId?.startsWith(LC_SCHEDULER_DATABASE_ID_PREFIX));
}

export function isLegacyLCSchedulerDatabaseId(databaseId: string | null | undefined): boolean {
  return Boolean(databaseId && isLCSchedulerDatabaseId(databaseId) && databaseId !== LC_SCHEDULER_DATABASE_ID);
}

export function resolveLCSchedulerDatabaseId(databaseId: string | null | undefined): string | null {
  if (!databaseId) return null;
  return isLCSchedulerDatabaseId(databaseId) ? LC_SCHEDULER_DATABASE_ID : databaseId;
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
        ],
      },
    },
    {
      id: LC_SCHEDULER_COLUMN_IDS.attendance,
      name: "근태",
      type: "select",
      width: 150,
      config: {
        options: LC_SCHEDULER_ATTENDANCE_OPTIONS.map(({ id, label, color }) => ({ id, label, color })),
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
    LC_SCHEDULER_COLUMN_IDS.status,
  ];
  const attendanceVisibleColumnIds = [
    LC_SCHEDULER_COLUMN_IDS.title,
    LC_SCHEDULER_COLUMN_IDS.assignees,
    LC_SCHEDULER_COLUMN_IDS.period,
    LC_SCHEDULER_COLUMN_IDS.attendance,
  ];
  const hiddenColumnIds = [
    LC_SCHEDULER_COLUMN_IDS.project,
    LC_SCHEDULER_COLUMN_IDS.attendance,
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
      id: LC_SCHEDULER_TASK_PRESET_ID,
      databaseId,
      name: "일정",
      scope: "workspace",
      columnDefaults: {
        [LC_SCHEDULER_COLUMN_IDS.title]: "일정",
        [LC_SCHEDULER_COLUMN_IDS.status]: "todo",
        [LC_SCHEDULER_COLUMN_IDS.attendance]: null,
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
      id: LC_SCHEDULER_ATTENDANCE_PRESET_ID,
      databaseId,
      name: "근태",
      scope: "workspace",
      columnDefaults: {
        [LC_SCHEDULER_COLUMN_IDS.title]: "연차",
        [LC_SCHEDULER_COLUMN_IDS.status]: "todo",
        [LC_SCHEDULER_COLUMN_IDS.attendance]: "annual-leave",
        [LC_SCHEDULER_COLUMN_IDS.color]: "#E74C3C",
        [LC_SCHEDULER_COLUMN_IDS.meta]: { kind: "leave", annualLeave: true, attendanceValue: "annual-leave" },
      },
      requiredColumnIds: attendanceVisibleColumnIds,
      visibleColumnIds: attendanceVisibleColumnIds,
      hiddenColumnIds: [
        ...hiddenColumnIds.filter((id) => id !== LC_SCHEDULER_COLUMN_IDS.attendance),
        LC_SCHEDULER_COLUMN_IDS.status,
      ],
      schedulerDefaults: { durationDays: 1, color: "#E74C3C", titlePrefix: LC_SCHEDULER_ATTENDANCE_TITLE },
      createdAt: t,
      updatedAt: t,
    },
  ];
}

function mergeSelectOptions(
  existing: ColumnDef["config"] | undefined,
  defaults: ColumnDef["config"] | undefined,
  removedIds: Set<string> = new Set(),
): ColumnDef["config"] | undefined {
  const defaultOptions = defaults?.options ?? [];
  const existingOptions = existing?.options;
  if (!existingOptions) return defaults;
  const defaultById = new Map(defaultOptions.map((option) => [option.id, option]));
  const nextOptions = existingOptions
    .filter((option) => !removedIds.has(option.id))
    .map((option) => ({ ...(defaultById.get(option.id) ?? {}), ...option }));
  const existingIds = new Set(nextOptions.map((option) => option.id));
  for (const option of defaultOptions) {
    if (!existingIds.has(option.id) && !removedIds.has(option.id)) {
      nextOptions.push(option);
    }
  }
  return {
    ...(defaults ?? {}),
    ...(existing ?? {}),
    options: nextOptions,
  };
}

function mergeSchedulerColumnConfig(
  columnId: string,
  existing: ColumnDef["config"] | undefined,
  defaults: ColumnDef["config"] | undefined,
): ColumnDef["config"] | undefined {
  if (columnId === LC_SCHEDULER_COLUMN_IDS.status) {
    return mergeSelectOptions(existing, defaults, new Set(["leave"]));
  }
  if (columnId === LC_SCHEDULER_COLUMN_IDS.attendance) {
    return mergeSelectOptions(existing, defaults, new Set(["hourly-leave"]));
  }
  return existing ?? defaults;
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
      config: mergeSchedulerColumnConfig(column.id, prev.config, column.config),
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
  if (columnDefaults[LC_SCHEDULER_COLUMN_IDS.status] === "leave") {
    columnDefaults[LC_SCHEDULER_COLUMN_IDS.status] = "todo";
    columnDefaults[LC_SCHEDULER_COLUMN_IDS.attendance] ??= "annual-leave";
    columnDefaults[LC_SCHEDULER_COLUMN_IDS.title] ??= "연차";
  }
  if (columnDefaults[LC_SCHEDULER_COLUMN_IDS.attendance] === "hourly-leave") {
    columnDefaults[LC_SCHEDULER_COLUMN_IDS.attendance] = "hourly-leave-1h";
  }
  if (preset.id === LC_SCHEDULER_TASK_PRESET_ID) {
    columnDefaults[LC_SCHEDULER_COLUMN_IDS.title] = "일정";
    columnDefaults[LC_SCHEDULER_COLUMN_IDS.attendance] = null;
    columnDefaults[LC_SCHEDULER_COLUMN_IDS.status] ??= "todo";
    columnDefaults[LC_SCHEDULER_COLUMN_IDS.color] ??= "#3498DB";
    columnDefaults[LC_SCHEDULER_COLUMN_IDS.meta] = {
      ...(
        columnDefaults[LC_SCHEDULER_COLUMN_IDS.meta] &&
        typeof columnDefaults[LC_SCHEDULER_COLUMN_IDS.meta] === "object" &&
        !Array.isArray(columnDefaults[LC_SCHEDULER_COLUMN_IDS.meta])
          ? columnDefaults[LC_SCHEDULER_COLUMN_IDS.meta] as Record<string, unknown>
          : {}
      ),
      kind: "schedule",
    };
  }
  if (preset.id === LC_SCHEDULER_ATTENDANCE_PRESET_ID) {
    columnDefaults[LC_SCHEDULER_COLUMN_IDS.title] = "연차";
    columnDefaults[LC_SCHEDULER_COLUMN_IDS.attendance] = "annual-leave";
    columnDefaults[LC_SCHEDULER_COLUMN_IDS.status] ??= "todo";
    columnDefaults[LC_SCHEDULER_COLUMN_IDS.color] ??= "#E74C3C";
    columnDefaults[LC_SCHEDULER_COLUMN_IDS.meta] = {
      ...(
        columnDefaults[LC_SCHEDULER_COLUMN_IDS.meta] &&
        typeof columnDefaults[LC_SCHEDULER_COLUMN_IDS.meta] === "object" &&
        !Array.isArray(columnDefaults[LC_SCHEDULER_COLUMN_IDS.meta])
          ? columnDefaults[LC_SCHEDULER_COLUMN_IDS.meta] as Record<string, unknown>
          : {}
      ),
      kind: "leave",
      annualLeave: true,
      attendanceValue: "annual-leave",
    };
  }
  const filterIds = (ids: string[]) => ids.filter((id) => !LEGACY_REMOVED_COLUMN_IDS.has(id));
  const nextName = preset.id === LC_SCHEDULER_ATTENDANCE_PRESET_ID && (!preset.name.trim() || preset.name === "연차")
    ? "근태"
    : preset.name;
  return {
    ...preset,
    name: nextName,
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
  const defaults = defaultPresets(databaseId, t);
  const defaultById = new Map(defaults.map((preset) => [preset.id, preset]));
  const nextPresets = presets.map((preset) => {
    const base = defaultById.get(preset.id);
    if (!base) return preset;
    defaultById.delete(preset.id);
    return {
      ...preset,
      requiredColumnIds: [...base.requiredColumnIds],
      visibleColumnIds: [...base.visibleColumnIds],
      hiddenColumnIds: [...base.hiddenColumnIds],
      databaseId,
    };
  });
  for (const preset of defaultById.values()) {
    nextPresets.push(preset);
  }
  return nextPresets.map((preset) => ({ ...preset, databaseId }));
}

function migrateAttendanceRows(
  databaseId: string,
  rowPageOrder: string[],
  usePageStore: typeof import("../../store/pageStore").usePageStore,
  enqueueUpsertPageRaw: typeof import("../../store/databaseStore/helpers").enqueueUpsertPageRaw,
): void {
  const mutatedPageIds: string[] = [];
  const t = Date.now();
  usePageStore.setState((state) => {
    let changed = false;
    const nextPages = { ...state.pages };
    for (const pageId of rowPageOrder) {
      const page = nextPages[pageId];
      if (!page || page.databaseId !== databaseId) continue;
      const cells = page.dbCells ?? {};
      const legacyStatusLeave = cells[LC_SCHEDULER_COLUMN_IDS.status] === "leave";
      const rawAttendance = cells[LC_SCHEDULER_COLUMN_IDS.attendance];
      const currentAttendance = typeof rawAttendance === "string"
        ? rawAttendance
        : null;
      const attendanceValue = normalizeLCSchedulerAttendanceValue(currentAttendance)
        ?? (legacyStatusLeave ? "annual-leave" : null);
      if (!legacyStatusLeave && !attendanceValue) continue;

      const nextCells = { ...cells };
      if (legacyStatusLeave) {
        nextCells[LC_SCHEDULER_COLUMN_IDS.status] = "todo";
      }
      if (attendanceValue) {
        nextCells[LC_SCHEDULER_COLUMN_IDS.attendance] = attendanceValue;
        const metaCell = nextCells[LC_SCHEDULER_COLUMN_IDS.meta];
        const meta = metaCell && typeof metaCell === "object" && !Array.isArray(metaCell)
          ? { ...(metaCell as Record<string, unknown>) }
          : {};
        nextCells[LC_SCHEDULER_COLUMN_IDS.meta] = {
          ...meta,
          kind: "leave",
          annualLeave: attendanceValue === "annual-leave",
          attendanceValue,
        };
      }

      nextPages[pageId] = {
        ...page,
        title: attendanceValue ? LC_SCHEDULER_ATTENDANCE_TITLE : page.title,
        dbCells: nextCells,
        updatedAt: t,
      };
      mutatedPageIds.push(pageId);
      changed = true;
    }
    return changed ? { pages: nextPages } : state;
  });

  const pages = usePageStore.getState().pages;
  for (const pageId of mutatedPageIds) {
    const page = pages[pageId];
    if (page) enqueueUpsertPageRaw(page);
  }
}

export async function ensureLCSchedulerDatabase(workspaceId: string): Promise<void> {
  const [{ useDatabaseStore }, { usePageStore }, { enqueueUpsertDatabase, enqueueUpsertPageRaw }] = await Promise.all([
    import("../../store/databaseStore"),
    import("../../store/pageStore"),
    import("../../store/databaseStore/helpers"),
  ]);
  const schedulerWorkspaceId = resolveLCSchedulerWorkspaceId(workspaceId);
  const databaseId = makeLCSchedulerDatabaseId(schedulerWorkspaceId);
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
    migrateAttendanceRows(databaseId, next.rowPageOrder, usePageStore, enqueueUpsertPageRaw);
    useDatabaseStore.setState((s) =>
      schedulerWorkspaceId === LC_SCHEDULER_WORKSPACE_ID
        ? s
        : s.cacheWorkspaceId === schedulerWorkspaceId
          ? s
          : { ...s, cacheWorkspaceId: schedulerWorkspaceId },
    );
    return;
  }

  useDatabaseStore.setState((s) => ({
    ...s,
    databases: { ...s.databases, [databaseId]: next },
    cacheWorkspaceId: schedulerWorkspaceId === LC_SCHEDULER_WORKSPACE_ID
      ? s.cacheWorkspaceId
      : schedulerWorkspaceId,
  }));
  migrateAttendanceRows(databaseId, next.rowPageOrder, usePageStore, enqueueUpsertPageRaw);
  enqueueUpsertDatabase(next);
}
