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
  | "progress"
  | "itemFetch";

/**
 * 컬럼 타입별 정책 메타 — 산재하던 minWidth/groupable/arrayValued/idLabelBacked 의 단일 출처.
 * `Record<ColumnType, ...>` 라 새 타입 추가 시 누락 항목을 컴파일러가 강제 검출한다
 * (과거 Set/배열 형태일 때는 새 타입 누락이 런타임까지 통과하던 표면).
 *
 * - minWidth      : colgroup width/minWidth 기본값(px)
 * - groupable     : 표/리스트/갤러리 그룹화 대상 여부(칸반 제외)
 * - arrayValued   : 다중 값(배열)로 저장되는 타입 — 시드/필터가 배열을 기대
 * - idLabelBacked : 셀 값이 id 이고 라벨은 별도 해석이 필요한 타입(옵션/사람/링크류)
 */
export type ColumnTypeMeta = {
  minWidth: number;
  groupable: boolean;
  arrayValued: boolean;
  idLabelBacked: boolean;
};

export const COLUMN_TYPE_META: Record<ColumnType, ColumnTypeMeta> = {
  title: { minWidth: 200, groupable: false, arrayValued: false, idLabelBacked: false },
  text: { minWidth: 160, groupable: false, arrayValued: false, idLabelBacked: false },
  json: { minWidth: 220, groupable: false, arrayValued: false, idLabelBacked: false },
  number: { minWidth: 100, groupable: false, arrayValued: false, idLabelBacked: false },
  select: { minWidth: 140, groupable: true, arrayValued: false, idLabelBacked: true },
  multiSelect: { minWidth: 180, groupable: false, arrayValued: true, idLabelBacked: true },
  status: { minWidth: 140, groupable: true, arrayValued: false, idLabelBacked: true },
  date: { minWidth: 120, groupable: false, arrayValued: false, idLabelBacked: false },
  person: { minWidth: 140, groupable: true, arrayValued: true, idLabelBacked: true },
  file: { minWidth: 160, groupable: false, arrayValued: false, idLabelBacked: false },
  checkbox: { minWidth: 60, groupable: false, arrayValued: false, idLabelBacked: false },
  url: { minWidth: 180, groupable: false, arrayValued: false, idLabelBacked: false },
  phone: { minWidth: 180, groupable: false, arrayValued: false, idLabelBacked: false },
  email: { minWidth: 180, groupable: false, arrayValued: false, idLabelBacked: false },
  dbLink: { minWidth: 180, groupable: false, arrayValued: false, idLabelBacked: true },
  pageLink: { minWidth: 200, groupable: false, arrayValued: true, idLabelBacked: true },
  progress: { minWidth: 140, groupable: false, arrayValued: false, idLabelBacked: false },
  itemFetch: { minWidth: 200, groupable: false, arrayValued: true, idLabelBacked: true },
};

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
   * true 면 선택한 DB에서 현재 행 pageId를 pageLink로 포함하는 행을 찾아
   * 지정 컬럼 값을 자동으로 가져온다.
   */
  automation?: boolean;
  /**
   * 설정 시 — 셀 값을 현재 행의 해당 pageLink 컬럼이 가리키는 첫 페이지의
   * `databaseId`/`columnId` 셀에서 자동으로 가져옴 (read-only 미러).
   * 미설정 시에는 옵션 목록만 미러링되고 값은 독립적으로 편집 가능.
   */
  viaPageLinkColumnId?: string;
};

/** 진행률 컬럼이 다른 DB의 페이지들 진척을 계산할 때 참조하는 소스 정의 */
export type ProgressSourceConfig = {
  /** 진행률을 계산할 대상 DB. linkedPagesFromColumn 모드에서는 연결 컬럼의 대상 DB를 캐시한다. */
  databaseId: string;
  /** 완료 여부 판단에 사용할 컬럼(보통 status 또는 select) */
  columnId: string;
  /** @deprecated 완료 판정은 상태 컬럼의 "완료"/done 옵션을 자동 감지한다. */
  completedValue?: string;
  /**
   * 대상 페이지를 어떻게 결정할지:
   * - `linkedPagesFromColumn` : 현재 행의 특정 pageLink 컬럼에 연결된 페이지들만 계산
   * - `allRows`               : 대상 DB의 모든 행 페이지
   */
  scope?:
    | { mode: "linkedPagesFromColumn"; pageLinkColumnId: string }
    | { mode: "allRows" };
};

export type TimelineDateCardTitleMode = "pageTitle" | "custom";

export type TimelineDateCardConfig = {
  /** 타임라인에 이 날짜 컬럼을 별도 일정 카드로 표시 */
  enabled?: boolean;
  /** 일정 카드 제목을 페이지 제목으로 쓸지, 컬럼별 별도 문구로 쓸지 */
  titleMode?: TimelineDateCardTitleMode;
  /** titleMode가 custom일 때 카드에 표시할 제목 */
  title?: string;
  /** 카드 배경색 */
  color?: string;
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
    /** 날짜 컬럼 전용 타임라인 카드 표시 설정 */
    timelineCard?: TimelineDateCardConfig;
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
    /**
     * pageLink 컬럼 — pageLinkScopeDatabaseId DB에서 현재 행과 연결된 항목을 찾고,
     * 그 항목의 지정 pageLink 컬럼값을 현재 셀에 그대로 표시한다.
     */
    pageLinkMirrorColumnId?: string;
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
    /**
     * itemFetch 컬럼 — 다른 DB의 특정 컬럼값이 현재 행 제목과 일치하는 행 페이지를 자동으로 불러온다.
     * pageLink 타입 컬럼이 matchColumnId 이면 현재 행의 pageId가 배열에 포함되는지로 비교.
     * 그 외 타입이면 컬럼 값(문자열)이 현재 행 제목과 일치하는지 비교.
     */
    itemFetchSourceDatabaseId?: string;
    itemFetchMatchColumnId?: string;
  };
};

export type DateRangeValue = {
  start?: string;
  end?: string;
};

export type TemplateAutomationWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type DatabaseTemplateAutomationConfig = {
  /** 자동화별 고정 ID. 서버 EventBridge Scheduler 이름과 실행 원장 키의 기준값이다. */
  id: string;
  /** false 이면 서버 스케줄러 대상에서 제거된다. */
  enabled: boolean;
  /** 0=일요일, 6=토요일. EventBridge Scheduler cron 요일로 변환해 사용한다. */
  weekdays: TemplateAutomationWeekday[];
  /** HH:mm, 자동 생성 시각. 초 단위 정밀도는 지원하지 않는다. */
  time: string;
  /** IANA timezone. 예: Asia/Seoul */
  timezone: string;
  /** 비어 있으면 템플릿 제목을 사용한다. */
  titlePrefix?: string;
  /** 날짜 컬럼 수동 지정. 없으면 타임라인 날짜 컬럼, 그 다음 첫 date 컬럼을 사용한다. */
  dateColumnId?: string | null;
  /** 서버/스케줄러가 허용할 최대 재시도 횟수. */
  maxAttempts?: number;
  /** 이 날짜 이후에는 스케줄을 만들지 않는다. YYYY-MM-DD */
  endDate?: string | null;
  /** UI/서버 충돌 해소와 스케줄 갱신 감지를 위한 갱신 시각(epoch ms). */
  updatedAt?: number;
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
  // 옵션형 컬럼(선택·상태·멤버·연결 등)은 체크박스 다중 선택을 지원하므로 string[] 도 허용한다.
  // 자유 입력/숫자/날짜 컬럼은 단일 string 을 유지한다. (하위 호환: 기존 데이터는 string)
  value?: string | string[];
};

/** 다중 정렬 규칙 — 배열의 앞쪽이 우선 키. */
export type SortRule = {
  columnId: string;
  dir: "asc" | "desc";
};

/** 뷰별 표시/순서 설정 (#9). */
export type ViewSpecificConfig = {
  /** 이 뷰의 컬럼 순서. hiddenColumnIds가 없던 레거시 값은 보이는 컬럼 목록으로 해석한다. */
  visibleColumnIds?: string[];
  /** 숨김 컬럼 목록. 값이 있으면 visibleColumnIds는 숨김 컬럼까지 포함한 전체 순서다. */
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
  /** 표시설정 그룹화 — 선택한 컬럼으로 표/리스트/갤러리(+후속 타임라인)를 그룹 분할. null=그룹화 안 함. node attrs → 서버 동기화. */
  groupByColumnId: string | null;
  galleryCoverColumnId: string | null;
  timelineDateColumnId: string | null;
  /** 뷰별 컬럼 표시·순서 (#6, #9). */
  viewConfigs: ViewConfigsMap;
  /** 비활성화한 뷰 모드. table은 항상 표시되므로 저장되어 있어도 무시한다. */
  hiddenViewKinds: ViewKind[];
  /** 인라인 뷰에서 한 번에 표시할 최대 항목 수 (기본 30). fullPage는 무시. */
  itemLimit?: number;
  /** 데이터베이스 항목의 하위 페이지 트리 UI 활성화 여부. 기본값 false. */
  pageTreeEnabled?: boolean;
  /** 갤러리 뷰 열 수 (기본 4). node attrs → 서버 동기화. */
  galleryColumns?: number;
  /** 필터 프리셋 탭 목록 */
  filterPresets?: FilterPreset[];
  /** 현재 활성화된 프리셋 ID. null이면 전역 filterRules/sortRules 사용. */
  activePresetId?: string | null;
  /** LC 스케줄러 피처 모드에서 표시할 마일스톤 항목 ID. null이면 전체 표시. */
  schedulerFeatureMilestoneIds?: string[] | null;
  /**
   * LC 스케줄러 구성원 탭/타임라인 표시 순서. 작업 DB(LC_SCHEDULER_DATABASE_ID) panelState 에 저장해
   * 워크스페이스 전 사용자에게 공유 동기화한다(개인 설정 아님).
   */
  schedulerMemberOrder?: string[];
  /** LC 스케줄러 구성원 순서의 field-level LWW 타임스탬프(epoch ms). */
  schedulerMemberOrderUpdatedAt?: number;
};

/** DB 템플릿 — 새 행 생성 시 기본 셀 값을 미리 지정. */
export type DatabaseTemplate = {
  id: string;
  title: string;
  /** 기본 셀 값 */
  cells: Record<string, CellValue>;
  /** 템플릿 전용 페이지 ID — 페이지로 이동해 속성·내용을 편집. */
  pageId?: string;
  /** 이 템플릿으로 행을 자동 생성하는 EventBridge Scheduler 설정. */
  automation?: DatabaseTemplateAutomationConfig;
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
  groupByColumnId: null,
  galleryCoverColumnId: null,
  timelineDateColumnId: null,
  viewConfigs: {},
  hiddenViewKinds: [],
  pageTreeEnabled: false,
  galleryColumns: 4,
});

/** 컬럼 타입별 기본 최소 폭(px) — colgroup의 width/minWidth에 적용. */
export function defaultMinWidthForType(type: ColumnType): number {
  return COLUMN_TYPE_META[type]?.minWidth ?? 140;
}

/**
 * 표시 UI(뷰·표시설정·속성 패널)에서 항상 숨기는 내부 전용 컬럼 id.
 * LC 스케줄러의 카드 색상·메타 컬럼은 우클릭 프리셋 메뉴 등 내부 로직에서만 사용하므로
 * 사용자가 볼 수 있는 어떤 화면에서도 노출/선택되지 않는다.
 * (scheduler/database.ts 의 LC_SCHEDULER_COLUMN_IDS.color / .meta 와 동일 — 순환 import 방지용 인라인 상수)
 */
const INTERNAL_HIDDEN_COLUMN_IDS = new Set<string>([
  "lc-scheduler:color",
  "lc-scheduler:meta",
]);

/** 사용자 화면에서 항상 숨겨야 하는 내부 전용 컬럼인지 판별. */
export function isInternalHiddenColumnId(id: string): boolean {
  return INTERNAL_HIDDEN_COLUMN_IDS.has(id);
}

type ViewColumnIdentity = Pick<ColumnDef, "id" | "type">;

export type ViewColumnOrderState = {
  orderedColumnIds: string[];
  visibleColumnIds: string[];
  hiddenColumnIds: string[];
};

function viewConfigurableColumns(columns: ViewColumnIdentity[]): ViewColumnIdentity[] {
  return columns.filter((column) => !isInternalHiddenColumnId(column.id));
}

function uniqueExistingColumnIds(
  candidateIds: readonly string[] | undefined,
  allowedIds: Set<string>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of candidateIds ?? []) {
    if (!allowedIds.has(id) || seen.has(id)) continue;
    out.push(id);
    seen.add(id);
  }
  return out;
}

function completeColumnOrder(
  allColumnIds: string[],
  preferredIds: readonly string[] | undefined,
): string[] {
  const allowedIds = new Set(allColumnIds);
  const out = uniqueExistingColumnIds(preferredIds, allowedIds);
  const seen = new Set(out);
  for (const id of allColumnIds) {
    if (seen.has(id)) continue;
    out.push(id);
    seen.add(id);
  }
  return out;
}

function sanitizeHiddenColumnIds(
  hiddenColumnIds: readonly string[] | undefined,
  allowedIds: Set<string>,
  titleColumnId: string | undefined,
): string[] {
  return uniqueExistingColumnIds(hiddenColumnIds, allowedIds)
    .filter((id) => id !== titleColumnId);
}

export function resolveViewColumnOrderState(
  columns: ViewColumnIdentity[],
  _viewKind: ViewKind,
  cfg: ViewSpecificConfig | undefined,
): ViewColumnOrderState {
  const configurableColumns = viewConfigurableColumns(columns);
  const allColumnIds = configurableColumns.map((column) => column.id);
  const allowedIds = new Set(allColumnIds);
  const titleColumnId = configurableColumns.find((column) => column.type === "title")?.id;
  const hasStoredOrder = Array.isArray(cfg?.visibleColumnIds);
  const hasStoredHidden = Array.isArray(cfg?.hiddenColumnIds);

  const orderedColumnIds = hasStoredOrder
    ? completeColumnOrder(allColumnIds, cfg?.visibleColumnIds)
    : allColumnIds;

  let hiddenColumnIds: string[];
  if (hasStoredOrder && !hasStoredHidden) {
    const legacyVisible = new Set(uniqueExistingColumnIds(cfg?.visibleColumnIds, allowedIds));
    if (titleColumnId) legacyVisible.add(titleColumnId);
    hiddenColumnIds = allColumnIds.filter((id) => !legacyVisible.has(id));
  } else {
    hiddenColumnIds = sanitizeHiddenColumnIds(cfg?.hiddenColumnIds, allowedIds, titleColumnId);
  }

  const hidden = new Set(hiddenColumnIds);
  const visibleColumnIds = orderedColumnIds.filter(
    (id) => id === titleColumnId || !hidden.has(id),
  );

  return { orderedColumnIds, visibleColumnIds, hiddenColumnIds };
}

export function buildViewColumnConfig(
  columns: ViewColumnIdentity[],
  _viewKind: ViewKind,
  orderedColumnIds: readonly string[],
  hiddenColumnIds: readonly string[],
): ViewSpecificConfig {
  const configurableColumns = viewConfigurableColumns(columns);
  const allColumnIds = configurableColumns.map((column) => column.id);
  const allowedIds = new Set(allColumnIds);
  const titleColumnId = configurableColumns.find((column) => column.type === "title")?.id;
  return {
    visibleColumnIds: completeColumnOrder(allColumnIds, orderedColumnIds),
    hiddenColumnIds: sanitizeHiddenColumnIds(hiddenColumnIds, allowedIds, titleColumnId),
  };
}

export function setColumnVisibleInViewConfig(
  columns: ViewColumnIdentity[],
  viewKind: ViewKind,
  cfg: ViewSpecificConfig | undefined,
  columnId: string,
  visible: boolean,
): ViewSpecificConfig {
  const state = resolveViewColumnOrderState(columns, viewKind, cfg);
  const titleColumnId = viewConfigurableColumns(columns).find((column) => column.type === "title")?.id;
  if (columnId === titleColumnId) {
    return buildViewColumnConfig(columns, viewKind, state.orderedColumnIds, state.hiddenColumnIds);
  }
  const hidden = new Set(state.hiddenColumnIds);
  if (visible) hidden.delete(columnId);
  else hidden.add(columnId);
  return buildViewColumnConfig(columns, viewKind, state.orderedColumnIds, [...hidden]);
}

export function moveVisibleColumnInViewConfig(
  columns: ViewColumnIdentity[],
  viewKind: ViewKind,
  cfg: ViewSpecificConfig | undefined,
  fromVisibleIndex: number,
  toVisibleIndex: number,
): ViewSpecificConfig {
  const state = resolveViewColumnOrderState(columns, viewKind, cfg);
  if (
    fromVisibleIndex < 0 ||
    toVisibleIndex < 0 ||
    fromVisibleIndex >= state.visibleColumnIds.length ||
    toVisibleIndex >= state.visibleColumnIds.length ||
    fromVisibleIndex === toVisibleIndex
  ) {
    return buildViewColumnConfig(columns, viewKind, state.orderedColumnIds, state.hiddenColumnIds);
  }

  const nextVisible = [...state.visibleColumnIds];
  const [moved] = nextVisible.splice(fromVisibleIndex, 1);
  if (moved) nextVisible.splice(toVisibleIndex, 0, moved);

  const visibleSlots = new Set(state.visibleColumnIds);
  const queue = [...nextVisible];
  const nextOrder = state.orderedColumnIds.map((id) =>
    visibleSlots.has(id) ? (queue.shift() ?? id) : id,
  );

  return buildViewColumnConfig(columns, viewKind, nextOrder, state.hiddenColumnIds);
}

/**
 * 현재 뷰에서 보일 컬럼을 순서대로 반환.
 * - hiddenColumnIds가 있으면 visibleColumnIds를 전체 순서로 보고 숨김 위치를 보존한다.
 * - hiddenColumnIds가 없는 레거시 visibleColumnIds는 보이는 컬럼 목록으로 유지한다.
 * - 설정이 없으면 bundle 컬럼 - hiddenColumnIds.
 * - 내부 전용 컬럼은 설정과 무관하게 항상 제외한다.
 */
export function getVisibleOrderedColumns(
  columns: ColumnDef[],
  viewKind: ViewKind,
  viewConfigs: ViewConfigsMap | undefined,
): ColumnDef[] {
  const cfg = viewConfigs?.[viewKind];
  const titleCol = columns.find((c) => c.type === "title");
  if (cfg?.visibleColumnIds || cfg?.hiddenColumnIds) {
    const columnsById = new Map(columns.map((c) => [c.id, c]));
    const state = resolveViewColumnOrderState(columns, viewKind, cfg);
    const ordered: ColumnDef[] = [];
    for (const columnId of state.visibleColumnIds) {
      const column = columnsById.get(columnId);
      if (!column || isInternalHiddenColumnId(column.id)) continue;
      ordered.push(column);
    }
    return ordered;
  }
  const hidden = new Set(cfg?.hiddenColumnIds ?? []);
  return columns.filter(
    (c) =>
      c.id === titleCol?.id || (!hidden.has(c.id) && !isInternalHiddenColumnId(c.id)),
  );
}

export type DatabaseBundle = {
  meta: DatabaseMeta;
  columns: ColumnDef[];
  presets?: DatabaseRowPreset[];
  /** 원본 DB 화면의 필터 프리셋 탭·정렬·뷰 설정 — DB 자체와 함께 동기화한다. */
  panelState?: DatabasePanelState;
  /** 행 페이지 id 배열 — 실제 행 데이터는 pageStore.pages[pageId] */
  rowPageOrder: string[];
};
