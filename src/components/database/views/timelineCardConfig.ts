import { useDatabaseStore } from "../../../store/databaseStore";
import type { ColumnDef, TimelineDateCardConfig } from "../../../types/database";

export function buildTimelineCardConfigPatch(
  databaseId: string,
  column: ColumnDef,
  patch: TimelineDateCardConfig,
): ColumnDef["config"] {
  const latestColumn = useDatabaseStore
    .getState()
    .databases[databaseId]?.columns.find((candidate) => candidate.id === column.id);
  const baseConfig = latestColumn?.config ?? column.config;

  return {
    ...baseConfig,
    timelineCard: {
      ...(baseConfig?.timelineCard ?? {}),
      ...patch,
    },
  };
}
