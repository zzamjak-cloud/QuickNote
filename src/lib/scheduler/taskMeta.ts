export type SchedulerTaskKind = "schedule" | "leave";

export type SchedulerTaskMeta = {
  kind?: SchedulerTaskKind;
  rowIndexByAssigneeId?: Record<string, number>;
  colorByAssigneeId?: Record<string, string>;
  textColorByAssigneeId?: Record<string, string>;
  textColor?: string | null;
  [key: string]: unknown;
};

const GLOBAL_ROW_INDEX_KEY = "__global__";

function rowIndexKey(assigneeId: string | null | undefined): string {
  return assigneeId || GLOBAL_ROW_INDEX_KEY;
}

function parseStringMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => typeof item === "string" && item.trim());
  return entries.length > 0 ? Object.fromEntries(entries) as Record<string, string> : undefined;
}

function withStringMapValue(
  map: Record<string, string> | undefined,
  key: string,
  value: string | null | undefined,
): Record<string, string> | undefined {
  const next = { ...(map ?? {}) };
  if (typeof value === "string" && value.trim()) {
    next[key] = value;
  } else {
    delete next[key];
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

export function parseSchedulerTaskMeta(value: unknown): SchedulerTaskMeta {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const kind = record.kind === "leave" || record.kind === "schedule"
    ? record.kind
    : undefined;
  const rowIndexByAssigneeId =
    record.rowIndexByAssigneeId &&
    typeof record.rowIndexByAssigneeId === "object" &&
    !Array.isArray(record.rowIndexByAssigneeId)
      ? Object.fromEntries(
          Object.entries(record.rowIndexByAssigneeId as Record<string, unknown>)
            .filter(([, rowIndex]) => typeof rowIndex === "number" && Number.isFinite(rowIndex)),
        ) as Record<string, number>
      : undefined;
  return {
    ...record,
    kind,
    rowIndexByAssigneeId,
    colorByAssigneeId: parseStringMap(record.colorByAssigneeId),
    textColorByAssigneeId: parseStringMap(record.textColorByAssigneeId),
    textColor: typeof record.textColor === "string" ? record.textColor : null,
  };
}

export function getSchedulerTaskCardColor(
  meta: SchedulerTaskMeta,
  assigneeId: string | null | undefined,
): string | null {
  return meta.colorByAssigneeId?.[rowIndexKey(assigneeId)] ?? null;
}

export function getSchedulerTaskCardTextColor(
  meta: SchedulerTaskMeta,
  assigneeId: string | null | undefined,
): string | null {
  return meta.textColorByAssigneeId?.[rowIndexKey(assigneeId)] ?? null;
}

export function setSchedulerTaskCardColor(
  meta: SchedulerTaskMeta,
  assigneeId: string | null | undefined,
  color: string | null | undefined,
  textColor: string | null | undefined,
): SchedulerTaskMeta {
  return {
    ...meta,
    colorByAssigneeId: withStringMapValue(meta.colorByAssigneeId, rowIndexKey(assigneeId), color),
    textColorByAssigneeId: withStringMapValue(
      meta.textColorByAssigneeId,
      rowIndexKey(assigneeId),
      textColor,
    ),
  };
}

export function getSchedulerTaskRowIndex(
  meta: SchedulerTaskMeta,
  assigneeId: string | null | undefined,
): number {
  return meta.rowIndexByAssigneeId?.[rowIndexKey(assigneeId)] ?? 0;
}

export function setSchedulerTaskRowIndex(
  meta: SchedulerTaskMeta,
  assigneeId: string | null | undefined,
  rowIndex: number | null | undefined,
): SchedulerTaskMeta {
  if (rowIndex == null) return meta;
  return {
    ...meta,
    rowIndexByAssigneeId: {
      ...(meta.rowIndexByAssigneeId ?? {}),
      [rowIndexKey(assigneeId)]: rowIndex,
    },
  };
}
