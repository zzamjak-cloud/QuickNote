export type SchedulerTaskKind = "schedule" | "leave";

export type SchedulerTaskMeta = {
  kind?: SchedulerTaskKind;
  rowIndexByAssigneeId?: Record<string, number>;
  textColor?: string | null;
  [key: string]: unknown;
};

const GLOBAL_ROW_INDEX_KEY = "__global__";

function rowIndexKey(assigneeId: string | null | undefined): string {
  return assigneeId || GLOBAL_ROW_INDEX_KEY;
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
    textColor: typeof record.textColor === "string" ? record.textColor : null,
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
