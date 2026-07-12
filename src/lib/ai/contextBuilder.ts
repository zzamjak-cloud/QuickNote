// AI 컨텍스트 조립 — 페이지 본문(마크다운)·DB 현재 뷰(마크다운 표).
// 총량 상한을 넘으면 절단하고 "생략" 을 명시해 모델이 부분 컨텍스트임을 인지하게 한다.

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
/** DB 셀 표시 문자 상한. */
export const AI_DB_CELL_MAX_CHARS = 200;

export type AiContext = {
  label: string;
  markdown: string;
  pageId: string | null;
  databaseId?: string | null;
  truncated: boolean;
};

export function buildPageAiContext(pageId: string): AiContext | null {
  const page = usePageStore.getState().pages[pageId];
  if (!page) return null;

  const title = page.title?.trim() || "제목 없음";
  let markdown = `# ${title}\n\n${pageDocToMarkdown(page.doc)}`;
  let truncated = false;
  if (markdown.length > AI_CONTEXT_MAX_CHARS) {
    markdown = `${markdown.slice(0, AI_CONTEXT_MAX_CHARS)}\n\n…(내용이 길어 이후 생략됨)`;
    truncated = true;
  }
  return { label: title, markdown, pageId, databaseId: null, truncated };
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

  // 행 합성 (로컬 삭제 tombstone 행 제외 — useProcessedRows 와 동일 가드)
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

  // 현재 뷰 기준 필터·정렬·검색 — "지금 보고 있는 것"과 대화하는 멘탈 모델
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

  // 마크다운 표 직렬화
  const visibleColumns = columns.filter((c) => !isInternalHiddenColumnId(c.id));
  if (visibleColumns.length === 0) return null;
  const shownRows = rows.slice(0, AI_DB_MAX_ROWS);
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
    "행의 항목 페이지 본문은 포함되지 않았다(셀 값만).",
  ]
    .filter(Boolean)
    .join(" ");

  let markdown = `# ${label}\n\n${headNote}\n\n${[header, divider, ...bodyLines].join("\n")}`;
  let truncated = rows.length > shownRows.length || cellTruncated;
  if (markdown.length > AI_CONTEXT_MAX_CHARS) {
    markdown = `${markdown.slice(0, AI_CONTEXT_MAX_CHARS)}\n\n…(내용이 길어 이후 생략됨)`;
    truncated = true;
  }
  return { label, markdown, pageId: null, databaseId, truncated };
}
