// 컬럼 config의 sourceFromDb / progressSource 를 해석해 옵션·셀값·진행률을 도출하는 유틸.
// React 훅이 아니라 순수 함수로 두어 셀과 디스플레이 양쪽에서 동일하게 사용한다.

import type { ColumnDef, SelectOption, SearchFilterRule } from "../../types/database";
import type { DatabaseBundle } from "../../types/database";
import type { Page } from "../../types/page";
import type { Organization } from "../../store/organizationStore";
import type { Team } from "../../store/teamStore";
import type { SchedulerProject } from "../../store/schedulerProjectsStore";

/** 퀵노트 내부 엔티티 컨텍스트 — linkedScope 옵션 미러링 시 필요 */
export type ScopeOptionsCtx = {
  organizations: Organization[];
  teams: Team[];
  projects: SchedulerProject[];
};

/** linkedScope 가 지정된 컬럼의 옵션을 organization/team/project store에서 생성. */
function resolveLinkedScopeOptions(
  scope: "organization" | "team" | "project",
  ctx: ScopeOptionsCtx | undefined,
): SelectOption[] {
  if (!ctx) return [];
  if (scope === "organization") {
    return ctx.organizations.map((o) => ({ id: o.organizationId, label: o.name }));
  }
  if (scope === "team") {
    return ctx.teams.map((t) => ({ id: t.teamId, label: t.name }));
  }
  return ctx.projects.map((p) => ({ id: p.id, label: p.name, color: p.color }));
}

/**
 * sourceFromDb가 가리키는 원본 컬럼을 찾아 옵션 목록 반환.
 * 원본 컬럼이 다시 linkedScope/sourceFromDb 로 외부 미러링 중인 경우 재귀적으로 해석한다.
 * (예: 피처의 프로젝트 컬럼 → 마일스톤의 프로젝트 컬럼 → schedulerProjectsStore)
 */
export function resolveSyncedOptions(
  column: ColumnDef,
  databases: Record<string, DatabaseBundle>,
  scopeCtx?: ScopeOptionsCtx,
): SelectOption[] | null {
  const src = column.config?.sourceFromDb;
  if (!src) return null;
  const sourceCol = databases[src.databaseId]?.columns.find((c) => c.id === src.columnId);
  if (!sourceCol) return [];
  // 재귀 해석 — 원본이 linkedScope/sourceFromDb 라면 그 소스를 따라간다.
  return effectiveOptions(sourceCol, databases, scopeCtx);
}

/** select류 컬럼이 외부 옵션 소스에 묶여있는지 — 옵션 직접 편집 잠금 판단에 사용. */
export function isOptionSourceLocked(column: ColumnDef): boolean {
  return Boolean(column.config?.sourceFromDb || column.config?.linkedScope);
}

/**
 * sourceFromDb.viaPageLinkColumnId 가 설정된 컬럼이면 현재 행의 pageLink 셀에서
 * 첫 번째 페이지를 찾아 그 페이지의 sourceColumnId 셀값을 반환.
 * 미설정·미연결·미존재 시 undefined 반환 — 호출자는 fallback 으로 자기 값을 사용한다.
 */
export function resolveDerivedCellValue(
  column: ColumnDef,
  /** 현재 행의 dbCells (pageLink 컬럼 값을 포함) */
  currentRowCells: Record<string, unknown> | undefined,
  pages: Record<string, Page>,
  ctx?: {
    currentRowPageId?: string | null;
    databases?: Record<string, DatabaseBundle>;
  },
): unknown | undefined {
  const src = column.config?.sourceFromDb;
  if (!src) return undefined;
  const readSourceCell = (sourcePageId: string): unknown => {
    const sourcePage = pages[sourcePageId];
    const databases = ctx?.databases;
    const sourceColumn = databases?.[src.databaseId]?.columns.find((c) => c.id === src.columnId);
    if (!sourcePage || !sourceColumn) return sourcePage?.dbCells?.[src.columnId];
    const derived = resolveDerivedCellValue(sourceColumn, sourcePage.dbCells, pages, {
      currentRowPageId: sourcePageId,
      databases,
    });
    return derived !== undefined ? derived : sourcePage.dbCells?.[src.columnId];
  };

  if (src.automation) {
    const currentRowPageId = ctx?.currentRowPageId;
    const sourceDb = src.databaseId ? ctx?.databases?.[src.databaseId] : undefined;
    if (!currentRowPageId || !sourceDb || !src.columnId) {
      return undefined;
    }

    const currentPage = pages[currentRowPageId];
    const currentDb = currentPage?.databaseId ? ctx?.databases?.[currentPage.databaseId] : undefined;
    const sourceLinkColumns = (currentDb?.columns ?? []).filter(
      (c) => {
        if (c.type !== "pageLink") return false;
        if (c.config?.pageLinkScopeDatabaseId === src.databaseId) return true;
        const value = currentRowCells?.[c.id];
        return Array.isArray(value) && value.some((pageId) => typeof pageId === "string" && pages[pageId]?.databaseId === src.databaseId);
      },
    );
    const preferredSourceLinkColumn =
      sourceLinkColumns.find((c) => c.id === src.viaPageLinkColumnId) ??
      sourceLinkColumns.find((c) => /피처|피쳐|피커|feature/i.test(c.name)) ??
      sourceLinkColumns[0];
    const explicitSourcePageId = preferredSourceLinkColumn
      ? ((currentRowCells?.[preferredSourceLinkColumn.id] as unknown[] | undefined) ?? []).find(
          (pageId): pageId is string => typeof pageId === "string" && pages[pageId]?.databaseId === src.databaseId,
        )
      : undefined;
    if (explicitSourcePageId) {
      return readSourceCell(explicitSourcePageId);
    }

    const pageLinkColumnIds = sourceDb.columns
      .filter((c) => c.type === "pageLink" && (!currentPage?.databaseId || c.config?.pageLinkScopeDatabaseId === currentPage.databaseId))
      .map((c) => c.id);
    const fallbackPageLinkColumnIds = sourceDb.columns
      .filter((c) => c.type === "pageLink" && !pageLinkColumnIds.includes(c.id))
      .map((c) => c.id);
    const findSourceRowByReverseLink = (columnIds: string[]) => sourceDb.rowPageOrder.find((pageId) => {
      const cells = pages[pageId]?.dbCells ?? {};
      return columnIds.some((columnId) => {
        const value = cells[columnId];
        return Array.isArray(value) && (value as unknown[]).includes(currentRowPageId);
      });
    });
    const matchedPageId =
      findSourceRowByReverseLink(pageLinkColumnIds) ??
      findSourceRowByReverseLink(fallbackPageLinkColumnIds);
    if (matchedPageId) {
      return readSourceCell(matchedPageId);
    }

    const itemFetchColumn = currentDb?.columns.find(
      (c) => c.type === "itemFetch" && c.config?.itemFetchSourceDatabaseId === src.databaseId,
    );
    const fetchedPageId = itemFetchColumn
      ? resolveItemFetchPageIds(itemFetchColumn, currentRowPageId, ctx?.databases ?? {}, pages)[0]
      : undefined;
    if (fetchedPageId) {
      return readSourceCell(fetchedPageId);
    }

    const directLinkedPageId = Object.values(currentRowCells ?? {}).find((value) => {
      if (!Array.isArray(value)) return false;
      return value.some((pageId) => typeof pageId === "string" && pages[pageId]?.databaseId === src.databaseId);
    });
    if (Array.isArray(directLinkedPageId)) {
      const sourcePageId = directLinkedPageId.find(
        (pageId): pageId is string => typeof pageId === "string" && pages[pageId]?.databaseId === src.databaseId,
      );
      if (sourcePageId) {
        return readSourceCell(sourcePageId);
      }
    }
  }

  if (!src.viaPageLinkColumnId) return undefined;
  const linkedIds = currentRowCells?.[src.viaPageLinkColumnId];
  if (!Array.isArray(linkedIds)) return undefined;
  const firstId = linkedIds.find((v): v is string => typeof v === "string");
  if (!firstId) return undefined;
  const sourcePage = pages[firstId];
  if (!sourcePage) return undefined;
  return readSourceCell(firstId);
}

/** 컬럼이 자동 derivation 모드인지 — UI에서 편집 잠금 표시에 사용. */
export function isCellValueDerived(column: ColumnDef): boolean {
  const src = column.config?.sourceFromDb;
  return Boolean(src?.viaPageLinkColumnId || src?.automation);
}

/**
 * sourceFromDb / linkedScope 가 설정된 select 류 컬럼의 표시·편집에 사용할 효과적 옵션.
 *
 * 우선순위:
 *   1. linkedScope  → organization/team/project store
 *   2. sourceFromDb → 다른 DB의 컬럼 옵션
 *   3. 그 외        → column.config.options 그대로
 */
export function effectiveOptions(
  column: ColumnDef,
  databases: Record<string, DatabaseBundle>,
  scopeCtx?: ScopeOptionsCtx,
): SelectOption[] {
  const linked = column.config?.linkedScope;
  if (linked) return resolveLinkedScopeOptions(linked, scopeCtx);
  const synced = resolveSyncedOptions(column, databases, scopeCtx);
  if (synced) return synced;
  return column.config?.options ?? [];
}

function isCompletedToken(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "done" || normalized === "complete" || normalized === "completed" || normalized === "완료";
}

/** 다른 페이지의 셀값에서 "완료" 여부 판정 (status/select/multiSelect/checkbox 모두 대응). */
function isCellCompleted(
  cellValue: unknown,
  completedValue: string | undefined,
  column: ColumnDef | undefined,
): boolean {
  if (cellValue == null) return false;
  if (typeof cellValue === "boolean") return cellValue;
  const optionById = new Map((column?.config?.options ?? []).map((option) => [option.id, option]));
  const isCompletedString = (value: string) => {
    if (completedValue) return value === completedValue;
    const option = optionById.get(value);
    return isCompletedToken(value) || (option ? isCompletedToken(option.label) : false);
  };
  if (typeof cellValue === "string") return isCompletedString(cellValue);
  if (Array.isArray(cellValue)) {
    return cellValue.some((v) => typeof v === "string" && isCompletedString(v));
  }
  return false;
}

/** 현재 행이 컨텍스트 — progressSource.scope 가 linkedPagesFromColumn 모드일 때 어떤 페이지를 셀지 결정 */
type ProgressContext = {
  currentRowPageId?: string | null;
  /** 현재 행 페이지의 dbCells — currentRowPageId가 없거나 페이지스토어 접근이 곤란할 때 fallback */
  currentRowCells?: Record<string, unknown>;
};

function resolveItemFetchPageIds(
  column: ColumnDef,
  rowPageId: string | null | undefined,
  databases: Record<string, DatabaseBundle>,
  pages: Record<string, Page>,
): string[] {
  if (!rowPageId) return [];
  const sourceDbId = column.config?.itemFetchSourceDatabaseId;
  const matchColId = column.config?.itemFetchMatchColumnId;
  if (!sourceDbId || !matchColId) return [];
  const sourceDb = databases[sourceDbId];
  if (!sourceDb) return [];

  const currentTitle = pages[rowPageId]?.title ?? "";
  const matchCol = sourceDb.columns.find((c) => c.id === matchColId);
  const isPageLinkCol = matchCol?.type === "pageLink";

  return sourceDb.rowPageOrder.filter((pageId) => {
    const page = pages[pageId];
    if (!page) return false;
    const cellValue = page.dbCells?.[matchColId];
    if (isPageLinkCol) {
      return Array.isArray(cellValue) && (cellValue as unknown[]).includes(rowPageId);
    }
    return typeof cellValue === "string" && cellValue === currentTitle;
  });
}

/** 진행률 자동 계산 — `progressSource` 설정이 있으면 백분율(0-100) 반환, 없으면 null. */
export function computeProgressFromSource(
  column: ColumnDef,
  databases: Record<string, DatabaseBundle>,
  pages: Record<string, Page>,
  ctx: ProgressContext,
): number | null {
  const src = column.config?.progressSource;
  if (!src) return null;

  const targetDb = databases[src.databaseId];

  // 1) 대상 페이지 ID 목록 결정
  let targetPageIds: string[] = [];
  const scope = src.scope ?? { mode: "allRows" };

  if (scope.mode === "allRows") {
    if (!targetDb) return 0;
    targetPageIds = targetDb.rowPageOrder ?? [];
  } else if (scope.mode === "linkedPagesFromColumn") {
    // 현재 행의 특정 pageLink/itemFetch 컬럼 값에서 대상 페이지 목록 추출
    const currentPage = ctx.currentRowPageId ? pages[ctx.currentRowPageId] : undefined;
    const currentDb = currentPage?.databaseId ? databases[currentPage.databaseId] : undefined;
    const sourceColumn = currentDb?.columns.find((c) => c.id === scope.pageLinkColumnId);
    if (sourceColumn?.type === "itemFetch") {
      targetPageIds = resolveItemFetchPageIds(sourceColumn, ctx.currentRowPageId, databases, pages);
    } else {
      const cellSource =
        ctx.currentRowCells ??
        (ctx.currentRowPageId ? pages[ctx.currentRowPageId]?.dbCells : undefined) ??
        {};
      const linked = (cellSource as Record<string, unknown>)[scope.pageLinkColumnId];
      if (Array.isArray(linked)) {
        targetPageIds = linked.filter((v): v is string => typeof v === "string");
      }
    }
  }

  if (targetPageIds.length === 0) return 0;

  // 2) 완료 카운트
  let completed = 0;
  for (const pid of targetPageIds) {
    const page = pages[pid];
    if (!page) continue;
    const cells = page.dbCells ?? {};
    const pageDb = page.databaseId ? databases[page.databaseId] : targetDb;
    const statusColumn = pageDb?.columns.find((c) => c.id === src.columnId);
    if (isCellCompleted(cells[src.columnId], src.completedValue, statusColumn)) completed += 1;
  }

  const pct = Math.round((completed / targetPageIds.length) * 100);
  return Math.min(100, Math.max(0, pct));
}

/** SearchFilterRule 배열을 페이지 후보 목록에 적용한다.
 *  필터는 AND 로 결합되며 value 가 비어있는 규칙은 무시한다. */
export function applySearchFilters(
  candidatePages: Page[],
  filters: SearchFilterRule[] | undefined,
  databases: Record<string, DatabaseBundle>,
  pages: Record<string, Page>,
): Page[] {
  if (!filters || filters.length === 0) return candidatePages;
  const active = filters.filter((f) => f.value);
  if (active.length === 0) return candidatePages;

  return candidatePages.filter((p) => {
    for (const rule of active) {
      const value = rule.value!;
      switch (rule.kind) {
        case "database":
          if (p.databaseId !== value) return false;
          break;
        case "milestone":
        case "feature": {
          // 페이지의 dbCells 중 pageLink 컬럼 어느 하나라도 value(=대상 pageId)를 포함하면 통과
          const cells = p.dbCells ?? {};
          const db = p.databaseId ? databases[p.databaseId] : null;
          if (!db) return false;
          const pageLinkColumnIds = db.columns
            .filter((c) => c.type === "pageLink")
            .map((c) => c.id);
          const hit = pageLinkColumnIds.some((cid) => {
            const v = cells[cid];
            return Array.isArray(v) && (v as unknown[]).includes(value);
          });
          if (!hit) return false;
          // pages 변수는 시그니처 일관성용 — 향후 확장 대비 (예: 전이적 링크 추적)
          void pages;
          break;
        }
        case "organization":
        case "team":
        case "project": {
          // 페이지가 속한 DB 의 컬럼 중 config.linkedScope 가 일치하는 컬럼을 찾아 비교.
          // (작업·마일스톤·피처 DB 모두 동일 패턴으로 동작)
          const db = p.databaseId ? databases[p.databaseId] : null;
          if (!db) return false;
          const matchedCols = db.columns.filter(
            (c) => c.config?.linkedScope === rule.kind,
          );
          if (matchedCols.length === 0) return false;
          const cells = p.dbCells ?? {};
          const hit = matchedCols.some((c) => cells[c.id] === value);
          if (!hit) return false;
          break;
        }
      }
    }
    return true;
  });
}
