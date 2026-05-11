/** 노션형 데이터베이스 — 직렬화 가능한 순수 JSON 타입 */

export const DATABASE_STORE_VERSION = 2;

export type ViewKind =
  | "table"
  | "kanban"
  | "timeline"
  | "gallery";

export type DatabaseLayout = "inline" | "fullPage";

export type ColumnType =
  | "title"
  | "text"
  | "number"
  | "select"
  | "multiSelect"
  | "status"
  | "date"
  | "person"
  | "file"
  | "checkbox"
  | "url"
  | "phone"
  | "email";

export type SelectOption = {
  id: string;
  label: string;
  color?: string;
};

export type ColumnDef = {
  id: string;
  name: string;
  type: ColumnType;
  /** 표 뷰에서의 너비(px). 미지정 시 브라우저 자동. */
  width?: number;
  config?: {
    options?: SelectOption[];
    /** 날짜 범위 UI 표시 */
    dateShowEnd?: boolean;
  };
};

export type DateRangeValue = {
  start?: string;
  end?: string;
};

export type FileCellItem = {
  fileId: string;
  name: string;
  mime: string;
  size: number;
};

/** 셀 값 — 컬럼 타입과 함께 해석 */
export type CellValue =
  | string
  | number
  | boolean
  | string[]
  | DateRangeValue
  | FileCellItem[]
  | null
  | undefined;

/** 뷰 계산용 행: pageStore + databaseStore 합성 결과 */
export type DatabaseRowView = {
  pageId: string;
  databaseId: string;
  title: string;
  /** titleColId 포함 (=title), 그 외는 page.dbCells */
  cells: Record<string, CellValue>;
};

export type DatabaseMeta = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

export type FilterOperator =
  | "equals"
  | "notEquals"
  | "contains"
  | "isEmpty"
  | "isNotEmpty"
  | "gt"
  | "lt";

export type FilterRule = {
  id: string;
  columnId: string;
  operator: FilterOperator;
  value?: string;
};

/** 다중 정렬 규칙 — 배열의 앞쪽이 우선 키. */
export type SortRule = {
  columnId: string;
  dir: "asc" | "desc";
};

/** 뷰별 표시/순서 설정 (#9). */
export type ViewSpecificConfig = {
  /** 이 뷰에서 보일 컬럼 id 순서. 비어 있으면 기본 순서 사용. */
  visibleColumnIds?: string[];
  /** visibleColumnIds 미지정 시 적용되는 숨김 목록. */
  hiddenColumnIds?: string[];
};

export type ViewConfigsMap = Partial<Record<ViewKind, ViewSpecificConfig>>;

/** DB 뷰 개인 UI 상태 — 로컬 전용 저장소에만 저장하고 문서/동기화 payload에 싣지 않는다. */
export type DatabasePanelState = {
  searchQuery: string;
  filterRules: FilterRule[];
  /** @deprecated sortRules로 대체. 로드 시 sortRules가 비어있고 이 값이 있으면 첫 규칙으로 마이그레이션. */
  sortColumnId: string | null;
  /** @deprecated sortRules로 대체. */
  sortDir: "asc" | "desc";
  /** 다중 정렬 규칙 (#4). */
  sortRules: SortRule[];
  kanbanGroupColumnId: string | null;
  galleryCoverColumnId: string | null;
  timelineDateColumnId: string | null;
  /** 뷰별 컬럼 표시·순서 (#6, #9). */
  viewConfigs: ViewConfigsMap;
  /** 비활성화한 뷰 모드. table은 항상 표시되므로 저장되어 있어도 무시한다. */
  hiddenViewKinds: ViewKind[];
};

export const emptyPanelState = (): DatabasePanelState => ({
  searchQuery: "",
  filterRules: [],
  sortColumnId: null,
  sortDir: "asc",
  sortRules: [],
  kanbanGroupColumnId: null,
  galleryCoverColumnId: null,
  timelineDateColumnId: null,
  viewConfigs: {},
  hiddenViewKinds: [],
});

/** 컬럼 타입별 기본 최소 폭(px) — colgroup의 width/minWidth에 적용. */
export function defaultMinWidthForType(type: ColumnType): number {
  switch (type) {
    case "title": return 200;
    case "text": return 160;
    case "number": return 100;
    case "select":
    case "status": return 140;
    case "multiSelect": return 180;
    case "date": return 120;
    case "person": return 140;
    case "file": return 160;
    case "checkbox": return 60;
    case "url":
    case "email":
    case "phone": return 180;
    default: return 140;
  }
}

/**
 * 현재 뷰에서 보일 컬럼을 순서대로 반환.
 * - viewConfigs[viewKind].visibleColumnIds가 있으면 그 순서(존재하는 id만).
 * - 없으면 bundle 컬럼 - hiddenColumnIds.
 */
export function getVisibleOrderedColumns(
  columns: ColumnDef[],
  viewKind: ViewKind,
  viewConfigs: ViewConfigsMap | undefined,
): ColumnDef[] {
  const cfg = viewConfigs?.[viewKind];
  if (cfg?.visibleColumnIds && cfg.visibleColumnIds.length > 0) {
    const map = new Map(columns.map((c) => [c.id, c]));
    const out: ColumnDef[] = [];
    for (const id of cfg.visibleColumnIds) {
      const c = map.get(id);
      if (c) out.push(c);
    }
    return out;
  }
  const hidden = new Set(cfg?.hiddenColumnIds ?? []);
  return columns.filter((c) => !hidden.has(c.id));
}

export type DatabaseBundle = {
  meta: DatabaseMeta;
  columns: ColumnDef[];
  /** 행 페이지 id 배열 — 실제 행 데이터는 pageStore.pages[pageId] */
  rowPageOrder: string[];
};
