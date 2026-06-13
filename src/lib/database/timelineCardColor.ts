import type { CellValue } from "../../types/database";
import { isRecord } from "../util/typeGuards";

export const TIMELINE_CARD_COLOR_OVERRIDES_CELL_ID = "_qn_timelineCardColorOverrides";

type TimelineCardColorOverrides = Record<string, string>;

function isTimelineCardColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function getTimelineCardColorOverride(
  cells: Record<string, CellValue> | undefined,
  columnId: string,
): string | null {
  const raw = cells?.[TIMELINE_CARD_COLOR_OVERRIDES_CELL_ID];
  if (!isRecord(raw)) return null;
  const overrides: Record<string, unknown> = raw;
  const color = overrides[columnId];
  return isTimelineCardColor(color) ? color : null;
}

export function resolveTimelineCardColor(
  cells: Record<string, CellValue> | undefined,
  columnId: string,
  fallback: string,
): string {
  return getTimelineCardColorOverride(cells, columnId) ?? fallback;
}

export function makeTimelineCardColorOverrides(
  cells: Record<string, CellValue> | undefined,
  columnId: string,
  color: string,
): TimelineCardColorOverrides {
  const raw = cells?.[TIMELINE_CARD_COLOR_OVERRIDES_CELL_ID];
  const next: TimelineCardColorOverrides = {};
  if (isRecord(raw)) {
    const overrides: Record<string, unknown> = raw;
    for (const [key, value] of Object.entries(overrides)) {
      if (isTimelineCardColor(value)) {
        next[key] = value;
      }
    }
  }
  next[columnId] = color;
  return next;
}
