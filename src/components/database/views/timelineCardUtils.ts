// DatabaseTimelineView 카드 id/색상/제목 순수 유틸 + 상수 — 로직 변경 없음.
import type { DatabaseRowView } from "../../../types/database";
import { SELECT_COLOR_PRESETS } from "../selectColorPresets";
import type { TimelineDateEntry } from "./timelineTypes";

export const DEFAULT_TIMELINE_CARD_COLOR = "#16a34a";
export const TIMELINE_CARD_COLOR_PRESETS = SELECT_COLOR_PRESETS;

export const makeTimelineCardId = (pageId: string, columnId: string) => `${pageId}::${columnId}`;

export function isValidTimelineColor(value: string | undefined): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function defaultTimelineColor(index: number): string {
  return TIMELINE_CARD_COLOR_PRESETS[index % TIMELINE_CARD_COLOR_PRESETS.length] ?? DEFAULT_TIMELINE_CARD_COLOR;
}

export function timelineCardTitle(row: DatabaseRowView, entry: TimelineDateEntry): string {
  if (entry.titleMode === "custom") {
    const title = (entry.title ?? "").trim();
    if (title) return title;
    return entry.columnName;
  }
  return row.title || "제목 없음";
}
