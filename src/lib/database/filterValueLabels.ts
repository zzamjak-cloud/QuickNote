import type { Page } from "../../types/page";
import { COLUMN_TYPE_META } from "../../types/database";
import type {
  CellValue,
  ColumnDef,
  DatabaseBundle,
  SelectOption,
} from "../../types/database";
import type { Member } from "../../store/memberStore";
import {
  effectiveOptions,
  isCellValueDerived,
  resolveDerivedCellValue,
  resolveItemFetchPageIds,
  shouldUseManualCellValueForAutomation,
  type ScopeOptionsCtx,
} from "./columnSource";
import { resolvePageLinkMirrorValue } from "./pageLinkMirror";

type FilterLabelMember = Pick<Member, "memberId" | "name" | "email">;

export type FilterLabelContext = {
  databases: Record<string, DatabaseBundle>;
  pages: Record<string, Page>;
  members: readonly FilterLabelMember[];
  scopeCtx?: ScopeOptionsCtx;
};

type ResolveFilterableCellValueInput = {
  column: ColumnDef;
  rowPageId?: string | null;
  currentDatabaseId?: string | null;
  rawValue: CellValue;
  pages: Record<string, Page>;
  databases: Record<string, DatabaseBundle>;
};

function dedupeOptions(options: SelectOption[]): SelectOption[] {
  const seen = new Set<string>();
  const deduped: SelectOption[] = [];
  for (const option of options) {
    if (!option.id || seen.has(option.id)) continue;
    seen.add(option.id);
    deduped.push(option);
  }
  return deduped;
}

function pageTitle(page: Page | undefined): string {
  return page?.title?.trim() || "제목 없음";
}

function personOptions(members: readonly FilterLabelMember[]): SelectOption[] {
  return dedupeOptions(
    members.map((member) => ({
      id: member.memberId,
      // 유령/오염 캐시에서 name·email 이 undefined 인 멤버가 로드될 수 있어 옵셔널 체이닝으로 방어
      label: member.name?.trim() || member.email?.trim() || member.memberId,
    })),
  );
}

function databaseOptions(databases: Record<string, DatabaseBundle>): SelectOption[] {
  return dedupeOptions(
    Object.values(databases).map((database) => ({
      id: database.meta.id,
      label: (database.meta.title ?? "").trim() || "제목 없음",
    })),
  );
}

function pageOptionsForColumn(
  column: ColumnDef,
  pages: Record<string, Page>,
  databases: Record<string, DatabaseBundle>,
): SelectOption[] {
  const sourceDbId =
    column.type === "itemFetch"
      ? column.config?.itemFetchSourceDatabaseId
      : column.config?.pageLinkScopeDatabaseId;
  const scopedPageIds = sourceDbId ? databases[sourceDbId]?.rowPageOrder : undefined;
  const pageIds = scopedPageIds ?? Object.keys(pages);
  return dedupeOptions(
    pageIds.map((pageId) => ({
      id: pageId,
      label: pageTitle(pages[pageId]),
    })),
  );
}

export function filterDisplayOptionsForColumn(
  column: ColumnDef,
  ctx: FilterLabelContext,
): SelectOption[] {
  // 컬럼타입이 아니라 COLUMN_TYPE_META 의 filterLabelSource 로 디스패치한다 —
  // 새 컬럼타입은 META 한 줄 선언만으로 자동 처리된다(여기 분기 수정 불필요).
  switch (COLUMN_TYPE_META[column.type].filterLabelSource) {
    case "option":
      return effectiveOptions(column, ctx.databases, ctx.scopeCtx).filter(
        (option) => !option.divider,
      );
    case "person":
      return personOptions(ctx.members);
    case "database":
      return databaseOptions(ctx.databases);
    case "page":
      return pageOptionsForColumn(column, ctx.pages, ctx.databases);
    default:
      return column.config?.options?.filter((option) => !option.divider) ?? [];
  }
}

export function withFilterDisplayOptions(
  columns: readonly ColumnDef[],
  ctx: FilterLabelContext,
): ColumnDef[] {
  return columns.map((column) => {
    const options = filterDisplayOptionsForColumn(column, ctx);
    if (options.length === 0) return column;
    return {
      ...column,
      config: {
        ...(column.config ?? {}),
        options,
      },
    };
  });
}

export function extractFilterValueIds(value: CellValue): string[] {
  if (Array.isArray(value)) {
    return (value as unknown[]).filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0,
    );
  }
  if (typeof value === "string" && value.trim()) return [value];
  return [];
}

/**
 * id 기반 필터 값(페이지 연결·멤버·DB 연결 등) 하나를 사람이 알아볼 수 있는 라벨로 변환한다.
 * 우선 optionById 맵(스코프 옵션)에서 찾고, 없으면 컬럼 타입별 실제 소스(페이지 제목·멤버 이름·DB 제목)에서 해석한다.
 */
export function resolveFilterValueLabel(
  column: ColumnDef,
  value: string,
  ctx: FilterLabelContext,
  optionById?: Map<string, string>,
): string {
  const mapped = optionById?.get(value);
  if (mapped) return mapped;
  // filterDisplayOptionsForColumn 과 동일하게 filterLabelSource 로 디스패치.
  // 'option' 소스(select/status 등)는 위 optionById 맵으로 해석되므로 여기선 원시값으로 떨어진다.
  switch (COLUMN_TYPE_META[column.type].filterLabelSource) {
    case "page":
      return ctx.pages[value] ? pageTitle(ctx.pages[value]) : value;
    case "database":
      return ctx.databases[value]?.meta.title?.trim() || value;
    case "person": {
      const member = ctx.members.find((candidate) => candidate.memberId === value);
      if (!member) return value;
      return member.name?.trim() || member.email?.trim() || member.memberId;
    }
    default:
      return value;
  }
}

export function isIdLabelBackedColumn(column: ColumnDef): boolean {
  return COLUMN_TYPE_META[column.type]?.idLabelBacked ?? false;
}

export function resolveFilterableCellValue({
  column,
  rowPageId,
  currentDatabaseId,
  rawValue,
  pages,
  databases,
}: ResolveFilterableCellValueInput): CellValue {
  if (!rowPageId) return rawValue;
  const rowCells = pages[rowPageId]?.dbCells;
  if (isCellValueDerived(column)) {
    const derived = resolveDerivedCellValue(column, rowCells, pages, {
      currentRowPageId: rowPageId,
      databases,
    });
    return shouldUseManualCellValueForAutomation(column, derived)
      ? rawValue
      : ((derived as CellValue | undefined) ?? rawValue);
  }
  if (column.type === "pageLink") {
    return (
      resolvePageLinkMirrorValue({
        databases,
        pages,
        currentDatabaseId: currentDatabaseId ?? undefined,
        rowId: rowPageId,
        column,
      }) ?? rawValue
    );
  }
  if (column.type === "itemFetch") {
    return resolveItemFetchPageIds(column, rowPageId, databases, pages);
  }
  return rawValue;
}
