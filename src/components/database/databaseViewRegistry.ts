// DB 뷰 단일 등록점 — 아이콘/라벨/컴포넌트/가용성을 ViewKind 별로 한 곳에서 선언한다.
// 새 뷰 추가 시 이 레지스트리 한 곳만 수정하면 렌더(DatabaseBlockView)와
// 토글/메뉴(DatabaseToolbarControls, 상수 파생)가 함께 따라온다.
import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { Kanban, GalleryHorizontal, GanttChartSquare, Table2, List } from "lucide-react";
import type { ColumnDef, DatabasePanelState, ViewKind } from "../../types/database";

// 5개 뷰가 공유하는 동일 prop 형태.
export type DatabaseViewProps = {
  databaseId: string;
  panelState: DatabasePanelState;
  setPanelState: (p: Partial<DatabasePanelState>) => void;
  visibleRowLimit?: number;
};

export type DatabaseViewEntry = {
  icon: typeof Table2;
  label: string;
  component: LazyExoticComponent<ComponentType<DatabaseViewProps>>;
  // 현재 컬럼 구성에서 이 뷰를 선택할 수 있는지 (false 면 자동 숨김).
  isAvailable: (columns: ColumnDef[]) => boolean;
};

const TableView = lazy(() =>
  import("./views/DatabaseTableView").then((m) => ({ default: m.DatabaseTableView })),
);
const ListView = lazy(() =>
  import("./views/DatabaseListView").then((m) => ({ default: m.DatabaseListView })),
);
const KanbanView = lazy(() =>
  import("./views/DatabaseKanbanView").then((m) => ({ default: m.DatabaseKanbanView })),
);
const TimelineView = lazy(() =>
  import("./views/DatabaseTimelineView").then((m) => ({ default: m.DatabaseTimelineView })),
);
const GalleryView = lazy(() =>
  import("./views/DatabaseGalleryView").then((m) => ({ default: m.DatabaseGalleryView })),
);

// 키 순서 = 토글/메뉴 표시 순서. (기존 VIEW_LABELS 순서 유지: 표·리스트·칸반·타임라인·갤러리)
export const DATABASE_VIEW_REGISTRY: Record<ViewKind, DatabaseViewEntry> = {
  table: { icon: Table2, label: "표", component: TableView, isAvailable: () => true },
  list: { icon: List, label: "리스트", component: ListView, isAvailable: () => true },
  kanban: {
    icon: Kanban,
    label: "칸반",
    component: KanbanView,
    isAvailable: (columns) => columns.some((column) => column.type === "select"),
  },
  timeline: {
    icon: GanttChartSquare,
    label: "타임라인",
    component: TimelineView,
    isAvailable: (columns) => columns.some((column) => column.type === "date"),
  },
  gallery: { icon: GalleryHorizontal, label: "갤러리", component: GalleryView, isAvailable: () => true },
};

export const DATABASE_VIEW_ORDER = Object.keys(DATABASE_VIEW_REGISTRY) as ViewKind[];
