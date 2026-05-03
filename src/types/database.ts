/** 노션형 데이터베이스 — 직렬화 가능한 순수 JSON 타입 */

export const DATABASE_STORE_VERSION = 2;

export type ViewKind =
  | "table"
  | "kanban"
  | "gallery"
  | "list"
  | "timeline";

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

/** 블록별 UI 상태 — TipTap attrs JSON으로 저장 */
export type DatabasePanelState = {
  searchQuery: string;
  filterRules: FilterRule[];
  sortColumnId: string | null;
  sortDir: "asc" | "desc";
  kanbanGroupColumnId: string | null;
  galleryCoverColumnId: string | null;
  timelineDateColumnId: string | null;
};

export const emptyPanelState = (): DatabasePanelState => ({
  searchQuery: "",
  filterRules: [],
  sortColumnId: null,
  sortDir: "asc",
  kanbanGroupColumnId: null,
  galleryCoverColumnId: null,
  timelineDateColumnId: null,
});

export type DatabaseBundle = {
  meta: DatabaseMeta;
  columns: ColumnDef[];
  /** 행 페이지 id 배열 — 실제 행 데이터는 pageStore.pages[pageId] */
  rowPageOrder: string[];
};
