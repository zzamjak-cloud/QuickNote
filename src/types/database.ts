/** 노션형 데이터베이스 — 직렬화 가능한 순수 JSON 타입 */

export const DATABASE_STORE_VERSION = 2;

export type ViewKind =
  | "table"
  | "kanban"
  | "timeline"
  | "gallery"
  | "list";

export type DatabaseLayout = "inline" | "fullPage";

export type ColumnType =
  | "title"
  | "text"
  | "json"
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
  | "email"
  | "dbLink"
  | "pageLink"
  | "progress";

export type SelectOption = {
  id: string;
  label: string;
  color?: string;
  /** true 면 선택 불가능한 시각적 구분선 — 옵션 목록 그룹핑용. */
  divider?: boolean;
};

/** 다른 DB·페이지의 속성·페이지 검색 시 적용할 필터 — 사용자가 + 버튼으로 자유롭게 누적. */
export type SearchFilterRule = {
  id: string;
  /**
   * - `database`  : 특정 DB의 항목 페이지만
   * - `milestone` : 특정 마일스톤 항목(또는 그것에 연결된 페이지)
   * - `feature`   : 특정 피처 항목
   * - `organization` / `team` / `project` : 조직·팀·프로젝트 스코프 일치
   */
  kind: "database" | "milestone" | "feature" | "organization" | "team" | "project";
  /** kind에 따른 대상 id (databaseId / pageId / scopeId). 빈 값이면 비활성. */
  value?: string;
};

/** 다른 DB의 컬럼을 그대로 가져와 옵션·셀값을 미러링 */
export type ColumnSourceFromDb = {
  databaseId: string;
  columnId: string;
  /**
   * 설정 시 — 셀 값을 현재 행의 해당 pageLink 컬럼이 가리키는 첫 페이지의
   * `databaseId`/`columnId` 셀에서 자동으로 가져옴 (read-only 미러).
   * 미설정 시에는 옵션 목록만 미러링되고 값은 독립적으로 편집 가능.
   */
  viaPageLinkColumnId?: string;
};

/** 진행률 컬럼이 다른 DB의 페이지들 진척을 계산할 때 참조하는 소스 정의 */
export type ProgressSourceConfig = {
  /** 진행률을 계산할 대상 DB */
  databaseId: string;
  /** 완료 여부 판단에 사용할 컬럼(보통 status 또는 select) */
  columnId: string;
  /** 위 컬럼에서 "완료"로 간주할 옵션 id (또는 값) */
  completedValue: string;
  /**
   * 대상 페이지를 어떻게 결정할지:
   * - `linkedPagesFromColumn` : 현재 행의 특정 pageLink 컬럼에 연결된 페이지들만 계산
   * - `allRows`               : 대상 DB의 모든 행 페이지
   */
  scope?:
    | { mode: "linkedPagesFromColumn"; pageLinkColumnId: string }
    | { mode: "allRows" };
};

export type ColumnDef = {
  id: string;
  name: string;
  type: ColumnType;
  /** 속성 아이콘. 미지정 시 타입별 기본 아이콘으로 표시. (pageIcon 인코딩 문자열) */
  icon?: string;
  /** 표 뷰에서의 너비(px). 미지정 시 브라우저 자동. */
  width?: number;
  config?: {
    options?: SelectOption[];
    /** 날짜 범위 UI 표시 */
    dateShowEnd?: boolean;
    /** 표 셀 텍스트 자동 줄바꿈 여부 (기본: false, 1라인 클리핑) */
    wrapText?: boolean;
    /** @deprecated 미사용 — 데이터 호환을 위해 필드는 유지 */
    textAlign?: "left" | "center" | "right";
    /** select/multiSelect/status 컬럼 — 다른 DB 컬럼에서 옵션·값을 가져와 미러링 */
    sourceFromDb?: ColumnSourceFromDb;
    /** progress 컬럼 — 자동 계산 소스 */
    progressSource?: ProgressSourceConfig;
    /** pageLink 컬럼 — 검색 대상을 특정 DB로 제한 (없으면 전체) */
    pageLinkScopeDatabaseId?: string;
    /** pageLink/dbLink/select(외부소스) 컬럼 — 검색 시 사전 필터 */
    searchFilters?: SearchFilterRule[];
    /**
     * select/multiSelect/status 컬럼 — 옵션을 퀵노트 내부 엔티티 store에서 미러링.
     * - `"organization"` : organizationStore.organizations
     * - `"team"`         : teamStore.teams
     * - `"project"`      : schedulerProjectsStore.projects
     * 셀값에는 해당 엔티티 id가 저장된다.
     */
    linkedScope?: "organization" | "team" | "project";
  };
};

export type DateRangeValue = {
  start?: string;
  end?: string;
};

export type FileCellItem = {
  fileId: string;
  /** S3 첨부 ref. 없으면 legacy IndexedDB 파일로 해석한다. */
  src?: string;
  name: string;
  mime: string;
  size: number;
};

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** 셀 값 — 컬럼 타입과 함께 해석 */
export type CellValue =
  | string
  | number
  | boolean
  | string[]
  | JsonValue
  | DateRangeValue
  | FileCellItem[]
  | null
  | undefined;

/** 뷰 계산용 행: pageStore + databaseStore 합성 결과 */
export type DatabaseRowView = {
  pageId: string;
  databaseId: string;
  title: string;
  icon?: string | null;
  /** titleColId 포함 (=title), 그 외는 page.dbCells */
  cells: Record<string, CellValue>;
};

export type DatabaseMeta = {
  id: string;
  workspaceId?: string;
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
  /** 이 뷰에서 보일 컬럼 id 목록. 표시 순서는 항상 bundle.columns 순서를 따른다. */
  visibleColumnIds?: string[];
  /** visibleColumnIds 미지정 시 적용되는 숨김 목록. */
  hiddenColumnIds?: string[];
};

export type ViewConfigsMap = Partial<Record<ViewKind, ViewSpecificConfig>>;

/** 필터·정렬 프리셋 탭 */
export type FilterPreset = {
  id: string;
  name: string;
  /** pageIcon 인코딩 문자열 */
  icon?: string;
  filterRules: FilterRule[];
  sortRules: SortRule[];
};

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
  /** 인라인 뷰에서 한 번에 표시할 최대 항목 수 (기본 30). fullPage는 무시. */
  itemLimit?: number;
  /** 갤러리 뷰 열 수 (기본 4). node attrs → 서버 동기화. */
  galleryColumns?: number;
  /** 필터 프리셋 탭 목록 */
  filterPresets?: FilterPreset[];
  /** 현재 활성화된 프리셋 ID. null이면 전역 filterRules/sortRules 사용. */
  activePresetId?: string | null;
};

/** DB 템플릿 — 새 행 생성 시 기본 셀 값을 미리 지정. */
export type DatabaseTemplate = {
  id: string;
  title: string;
  /** 기본 셀 값 */
  cells: Record<string, CellValue>;
  /** 템플릿 전용 페이지 ID — 페이지로 이동해 속성·내용을 편집. */
  pageId?: string;
};

export type DatabaseRowPreset = {
  id: string;
  databaseId: string;
  name: string;
  description?: string;
  scope: "workspace" | "organization" | "team" | "project";
  scopeId?: string;
  columnDefaults: Record<string, CellValue>;
  requiredColumnIds: string[];
  visibleColumnIds: string[];
  hiddenColumnIds: string[];
  schedulerDefaults?: {
    durationDays?: number;
    color?: string;
    titlePrefix?: string;
    assigneeIds?: string[];
  };
  createdAt: number;
  updatedAt: number;
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
  galleryColumns: 4,
});

/** 컬럼 타입별 기본 최소 폭(px) — colgroup의 width/minWidth에 적용. */
export function defaultMinWidthForType(type: ColumnType): number {
  switch (type) {
    case "title": return 200;
    case "text": return 160;
    case "json": return 220;
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
    case "dbLink": return 180;
    case "pageLink": return 200;
    case "progress": return 140;
    default: return 140;
  }
}

/**
 * 현재 뷰에서 보일 컬럼을 순서대로 반환.
 * - viewConfigs[viewKind].visibleColumnIds가 있으면 그 집합을 bundle 컬럼 순서대로 반환.
 * - 없으면 bundle 컬럼 - hiddenColumnIds.
 */
export function getVisibleOrderedColumns(
  columns: ColumnDef[],
  viewKind: ViewKind,
  viewConfigs: ViewConfigsMap | undefined,
): ColumnDef[] {
  const cfg = viewConfigs?.[viewKind];
  const titleCol = columns.find((c) => c.type === "title");
  if (cfg?.visibleColumnIds) {
    const visible = new Set(cfg.visibleColumnIds);
    if (titleCol) visible.add(titleCol.id);
    return columns.filter((c) => visible.has(c.id));
  }
  const hidden = new Set(cfg?.hiddenColumnIds ?? []);
  return columns.filter((c) => c.id === titleCol?.id || !hidden.has(c.id));
}

export type DatabaseBundle = {
  meta: DatabaseMeta;
  columns: ColumnDef[];
  presets?: DatabaseRowPreset[];
  /** 행 페이지 id 배열 — 실제 행 데이터는 pageStore.pages[pageId] */
  rowPageOrder: string[];
};
