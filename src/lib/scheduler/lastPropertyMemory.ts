import type { CellValue } from "../../types/database";
import { LC_SCHEDULER_COLUMN_IDS } from "./database";

const STORAGE_KEY = "quicknote.scheduler.lastPropertyValues.v1";

type LastPropertyRecord = Record<string, CellValue>;
type LastPropertyMemory = Record<string, LastPropertyRecord>;

const REMEMBERED_COLUMN_IDS = [
  LC_SCHEDULER_COLUMN_IDS.organization,
  LC_SCHEDULER_COLUMN_IDS.team,
  LC_SCHEDULER_COLUMN_IDS.project,
  LC_SCHEDULER_COLUMN_IDS.milestone,
  LC_SCHEDULER_COLUMN_IDS.version,
  LC_SCHEDULER_COLUMN_IDS.feature,
  LC_SCHEDULER_COLUMN_IDS.status,
  LC_SCHEDULER_COLUMN_IDS.color,
] as const;

function readMemory(): LastPropertyMemory {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as LastPropertyMemory;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function writeMemory(memory: LastPropertyMemory): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch {
    // noop
  }
}

export function rememberSchedulerPropertyValues(
  workspaceId: string,
  cells: Record<string, CellValue> | undefined,
): void {
  if (!workspaceId || !cells) return;
  const current = readMemory();
  const nextRecord: LastPropertyRecord = { ...(current[workspaceId] ?? {}) };
  for (const columnId of REMEMBERED_COLUMN_IDS) {
    const value = cells[columnId];
    if (typeof value === "undefined" || value === null) continue;
    nextRecord[columnId] = value;
  }
  current[workspaceId] = nextRecord;
  writeMemory(current);
}

export function readRememberedSchedulerPropertyValues(workspaceId: string): LastPropertyRecord {
  if (!workspaceId) return {};
  const current = readMemory();
  return { ...(current[workspaceId] ?? {}) };
}
