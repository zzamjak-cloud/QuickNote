// AI 컨텍스트 조립 — 페이지 본문(마크다운)·DB 현재 뷰(마크다운 표).
// 총량 상한을 넘으면 절단하고 "생략" 을 명시해 모델이 부분 컨텍스트임을 인지하게 한다.
// options 로 행 수·행 본문 포함을 조절하고, parts 로 패널 칩 UI에 메타를 제공한다.

import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { useMemberStore } from "../../store/memberStore";
import { useOrganizationStore } from "../../store/organizationStore";
import { useTeamStore } from "../../store/teamStore";
import { useSchedulerProjectsStore } from "../../store/schedulerProjectsStore";
import { pageDocToMarkdown } from "../export/pageToMarkdown";
import { applyFilterSortSearch, resolveActiveFilterRules } from "../databaseQuery";
import {
  isCellValueDerived,
  resolveDerivedCellValue,
  shouldUseManualCellValueForAutomation,
} from "../database/columnSource";
import {
  resolveFilterableCellValue,
  withFilterDisplayOptions,
} from "../database/filterValueLabels";
import { createLocalDeletionFilter } from "../sync/localDeleteGuards";
import { formatPlainDisplay } from "../../components/database/databaseCellDisplayUtils";
import {
  isInternalHiddenColumnId,
  type CellValue,
  type ColumnDef,
  type DatabasePanelState,
  type DatabaseRowView,
} from "../../types/database";

/** 컨텍스트 총량 상한(문자) — 서버 MAX_CONTEXT_CHARS(120K)보다 여유 있게 작게. */
export const AI_CONTEXT_MAX_CHARS = 100_000;
/** DB 직렬화 행 상한 — 계획 §6 방어 1. */
export const AI_DB_MAX_ROWS = 200;
/** 행 본문 포함 시 자동 축소 상한. */
export const AI_DB_MAX_ROWS_WITH_BODIES = 30;
/** 행 본문 앞부분 상한(문자). */
export const AI_ROW_BODY_MAX_CHARS = 1_000;
/** DB 셀 표시 문자 상한. */
export const AI_DB_CELL_MAX_CHARS = 200;

export type AiContextOptions = {
  /** DB 행 상한. 미지정 시 includeRowBodies 에 따라 기본값. */
  maxRows?: number;
  /** 행 항목 페이지 본문 앞부분 포함. 켜면 행 상한 자동 축소. */
  includeRowBodies?: boolean;
  /** 페이지 컨텍스트에서 제외할 인라인 DB id (예약). */
  excludedDbIds?: string[];
};

export type AiContextPart = {
  kind: "body" | "database" | "selection";
  id?: string;
  title: string;
  includedRows?: number;
  totalRows?: number;
  chars: number;
};

export type AiContext = {
  label: string;
  markdown: string;
  pageId: string | null;
  databaseId?: string | null;
  truncated: boolean;
  parts: AiContextPart[];
  options: AiContextOptions;
  /** DB 컨텍스트 재조립용 — 현재 뷰 스냅샷. */
  panelState?: DatabasePanelState | null;
};

export function defaultMaxRows(options: AiContextOptions): number {
  if (typeof options.maxRows === "number" && options.maxRows > 0) return options.maxRows;
  return options.includeRowBodies ? AI_DB_MAX_ROWS_WITH_BODIES : AI_DB_MAX_ROWS;
}

export function buildPageAiContext(
  pageId: string,
  options: AiContextOptions = {},
): AiContext | null {
  const page = usePageStore.getState().pages[pageId];
  if (!page) return null;

  const title = page.title?.trim() || "제목 없음";
  let markdown = `# ${title}\n\n${pageDocToMarkdown(page.doc)}`;
  let truncated = false;
  if (markdown.length > AI_CONTEXT_MAX_CHARS) {
    markdown = `${markdown.slice(0, AI_CONTEXT_MAX_CHARS)}\n\n…(내용이 길어 이후 생략됨)`;
    truncated = true;
  }
  const parts: AiContextPart[] = [
    { kind: "body", title: "본문", chars: markdown.length },
  ];
  return {
    label: title,
    markdown,
    pageId,
    databaseId: null,
    truncated,
    parts,
    options: { ...options },
    panelState: null,
  };
}

/** 선택 영역 컨텍스트 — parts/options 필수 필드 채움. */
export function buildSelectionAiContext(args: {
  pageId: string;
  markdown: string;
  truncated: boolean;
  label?: string;
}): AiContext {
  const label = args.label ?? "선택 영역";
  return {
    label,
    markdown: args.markdown,
    pageId: args.pageId,
    databaseId: null,
    truncated: args.truncated,
    parts: [{ kind: "selection", title: label, chars: args.markdown.length }],
    options: {},
    panelState: null,
  };
}

/** 마크다운 표 셀 이스케이프 + 길이 상한. */
function tableCellText(raw: string): { text: string; truncated: boolean } {
  const flat = raw.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
  if (flat.length > AI_DB_CELL_MAX_CHARS) {
    return { text: `${flat.slice(0, AI_DB_CELL_MAX_CHARS)}…`, truncated: true };
  }
  return { text: flat, truncated: false };
}

/**
 * DB 현재 뷰 컨텍스트 — useProcessedRows 와 동일한 규칙(파생 컬럼 계산 → filterable 보정 →
 * 필터·정렬·검색)을 클릭 시 1회 순수 계산한다. 행/셀/총량 3중 상한 적용.
 */
export function buildDatabaseAiContext(
  databaseId: string,
  panelState: DatabasePanelState,
  options: AiContextOptions = {},
): AiContext | null {
  const databases = useDatabaseStore.getState().databases;
  const bundle = databases[databaseId];
  if (!bundle || !Array.isArray(bundle.columns) || !Array.isArray(bundle.rowPageOrder)) {
    return null;
  }
  const pages = usePageStore.getState().pages;
  const members = useMemberStore.getState().members;
  const organizations = useOrganizationStore.getState().organizations;
  const teams = useTeamStore.getState().teams;
  const projects = useSchedulerProjectsStore.getState().projects;

  const columns = bundle.columns as ColumnDef[];
  const titleCol = columns.find((c) => c.type === "title") ?? null;
  const nonTitleColumns = columns.filter((c) => c.type !== "title");
  const derivedColumns = nonTitleColumns.filter((c) => isCellValueDerived(c));

  const isLocallyDeleted = createLocalDeletionFilter();
  const ordered: DatabaseRowView[] = [];
  for (const rowPageId of bundle.rowPageOrder) {
    const page = pages[rowPageId];
    if (!page) continue;
    if (isLocallyDeleted("page", rowPageId, page.workspaceId ?? null)) continue;
    const cells: Record<string, CellValue> = { ...(page.dbCells ?? {}) };
    if (titleCol) cells[titleCol.id] = page.title;
    for (const column of derivedColumns) {
      const derived = resolveDerivedCellValue(column, cells, pages, {
        currentRowPageId: rowPageId,
        databases,
      });
      if (!shouldUseManualCellValueForAutomation(column, derived)) {
        cells[column.id] = (derived as CellValue) ?? null;
      }
    }
    for (const column of nonTitleColumns) {
      cells[column.id] = resolveFilterableCellValue({
        column,
        rowPageId,
        currentDatabaseId: databaseId,
        rawValue: cells[column.id],
        pages,
        databases,
      });
    }
    ordered.push({
      pageId: rowPageId,
      databaseId,
      title: page.title,
      icon: page.icon,
      cells,
    });
  }

  const activePreset =
    (panelState.filterPresets ?? []).find((p) => p.id === panelState.activePresetId) ?? null;
  const filterRules = resolveActiveFilterRules(panelState);
  const sortRules =
    activePreset?.sortRules && activePreset.sortRules.length > 0
      ? activePreset.sortRules
      : panelState.sortRules && panelState.sortRules.length > 0
        ? panelState.sortRules
        : panelState.sortColumnId
          ? [{ columnId: panelState.sortColumnId, dir: panelState.sortDir }]
          : [];
  const queryColumns = withFilterDisplayOptions(columns, {
    databases,
    pages,
    members,
    scopeCtx: { organizations, teams, projects },
  });
  const rows = applyFilterSortSearch(
    ordered,
    queryColumns,
    panelState.searchQuery,
    filterRules,
    sortRules,
  );

  const maxRows = defaultMaxRows(options);
  const visibleColumns = columns.filter((c) => !isInternalHiddenColumnId(c.id));
  if (visibleColumns.length === 0) return null;
  const shownRows = rows.slice(0, maxRows);
  let cellTruncated = false;
  const header = `| ${visibleColumns.map((c) => tableCellText(c.name || c.type).text).join(" | ")} |`;
  const divider = `| ${visibleColumns.map(() => "---").join(" | ")} |`;
  const bodyLines = shownRows.map((row) => {
    const cells = visibleColumns.map((c) => {
      const raw = c.type === "title" ? row.title : formatPlainDisplay(row.cells[c.id] ?? null, c);
      const { text, truncated } = tableCellText(raw ?? "");
      if (truncated) cellTruncated = true;
      return text;
    });
    return `| ${cells.join(" | ")} |`;
  });

  const label = bundle.meta?.title?.trim() || "데이터베이스";
  const filterActive =
    filterRules.length > 0 || Boolean(panelState.searchQuery?.trim());
  const headNote = [
    `총 ${rows.length}행 중 ${shownRows.length}행 표시${filterActive ? " (현재 뷰의 필터·검색 적용됨)" : ""}.`,
    rows.length > shownRows.length ? `…외 ${rows.length - shownRows.length}행 생략.` : null,
    options.includeRowBodies
      ? "선택한 행의 항목 페이지 본문 앞부분을 포함한다."
      : "행의 항목 페이지 본문은 포함되지 않았다(셀 값만). 필요 시 list_rows/get_row/get_page_content 도구로 온디맨드 조회 가능.",
  ]
    .filter(Boolean)
    .join(" ");

  let markdown = `# ${label}\n\n${headNote}\n\n${[header, divider, ...bodyLines].join("\n")}`;

  if (options.includeRowBodies) {
    const bodySections: string[] = [];
    for (const row of shownRows) {
      const page = pages[row.pageId];
      if (!page?.doc) continue;
      let body = pageDocToMarkdown(page.doc).trim();
      if (!body) continue;
      if (body.length > AI_ROW_BODY_MAX_CHARS) {
        body = `${body.slice(0, AI_ROW_BODY_MAX_CHARS)}…`;
        cellTruncated = true;
      }
      const rowTitle = (row.title || "제목 없음").trim();
      bodySections.push(`### 행 본문: ${rowTitle}\n\n${body}`);
    }
    if (bodySections.length > 0) {
      markdown += `\n\n## 항목 본문\n\n${bodySections.join("\n\n")}`;
    }
  }

  let truncated = rows.length > shownRows.length || cellTruncated;
  if (markdown.length > AI_CONTEXT_MAX_CHARS) {
    markdown = `${markdown.slice(0, AI_CONTEXT_MAX_CHARS)}\n\n…(내용이 길어 이후 생략됨)`;
    truncated = true;
  }

  const parts: AiContextPart[] = [
    {
      kind: "database",
      id: databaseId,
      title: label,
      includedRows: shownRows.length,
      totalRows: rows.length,
      chars: markdown.length,
    },
  ];

  return {
    label,
    markdown,
    pageId: null,
    databaseId,
    truncated,
    parts,
    options: { ...options, maxRows },
    panelState,
  };
}

/** 옵션 변경 후 동일 대상 컨텍스트 재조립. */
export function rebuildAiContext(
  current: AiContext,
  patch: Partial<AiContextOptions>,
): AiContext | null {
  const options: AiContextOptions = { ...current.options, ...patch };
  if (options.includeRowBodies && patch.includeRowBodies === true && patch.maxRows == null) {
    options.maxRows = AI_DB_MAX_ROWS_WITH_BODIES;
  }
  if (current.databaseId && current.panelState) {
    return buildDatabaseAiContext(current.databaseId, current.panelState, options);
  }
  if (current.pageId) {
    return buildPageAiContext(current.pageId, options);
  }
  return null;
}
