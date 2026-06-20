// DatabaseTimelineView 타입 정의 — type-only 추출, 런타임 0.
import type { DatabaseRowView } from "../../../types/database";

export type Granularity = "year" | "month" | "week";

export type TimelineDateEntry = {
  columnId: string;
  columnName: string;
  titleMode: "pageTitle" | "custom";
  title: string;
  color: string;
  isPrimary: boolean;
};

export type ContextPointerEvent = {
  button?: number;
  clientX: number;
  clientY: number;
  preventDefault: () => void;
  stopPropagation: () => void;
};

export type TimelineBoxRect = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
};

export type TimelineCardLayout = {
  id: string;
  row: DatabaseRowView;
  pageId: string;
  columnId: string;
  columnName: string;
  title: string;
  color: string;
  start: number;
  end: number;
  left: number;
  width: number;
  top: number;
  dateLabel: string;
  showDateLabel: boolean;
  tooltipText: string;
  isUnscheduled?: boolean;
};
