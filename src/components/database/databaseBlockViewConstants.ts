import {
  Kanban,
  GalleryHorizontal,
  GanttChartSquare,
  Table2,
  List,
} from "lucide-react";
import type { ViewKind } from "../../types/database";

export const VIEW_ICONS: Record<ViewKind, typeof Table2> = {
  table: Table2,
  list: List,
  kanban: Kanban,
  timeline: GanttChartSquare,
  gallery: GalleryHorizontal,
};

/** 뷰 토글 라벨(한국어). */
export const VIEW_LABELS: Record<ViewKind, string> = {
  table: "표",
  list: "리스트",
  kanban: "칸반",
  timeline: "타임라인",
  gallery: "갤러리",
};
