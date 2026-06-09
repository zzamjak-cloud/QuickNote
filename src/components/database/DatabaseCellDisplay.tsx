import type { CellValue, ColumnDef } from "../../types/database";
import { OptionChip } from "./cells/OptionChip";
import {
  formatPlainDisplay,
  stringArrayValue,
} from "./databaseCellDisplayUtils";
import { useDatabaseStore } from "../../store/databaseStore";
import { useMemberStore } from "../../store/memberStore";
import { usePageStore } from "../../store/pageStore";
import {
  computeProgressFromSource,
  isCellValueDerived,
  resolveDerivedCellValue,
  shouldUseManualCellValueForAutomation,
} from "../../lib/database/columnSource";
import { resolvePageLinkMirrorValue } from "../../lib/database/pageLinkMirror";
import { normalizePersonValue, personChipColor } from "./cells/utils";
import { useEffectiveOptions } from "./useEffectiveOptions";

type Props = {
  column: ColumnDef;
  value: CellValue;
  textClassName?: string;
  /** 현재 행 pageId — sourceFromDb.viaPageLinkColumnId 로 연결된 페이지에서 값 자동 미러링 시 필요 */
  rowId?: string;
};

function resolveSourceDisplayColumn(
  column: ColumnDef,
  databases: ReturnType<typeof useDatabaseStore.getState>["databases"],
): ColumnDef {
  let current = column;
  const seen = new Set<string>();
  for (let depth = 0; depth < 6; depth++) {
    const src = current.config?.sourceFromDb;
    if (!src) break;
    const key = `${src.databaseId}:${src.columnId}`;
    if (seen.has(key)) break;
    seen.add(key);
    const sourceColumn = databases[src.databaseId]?.columns.find((c) => c.id === src.columnId);
    if (!sourceColumn) break;
    current = sourceColumn;
  }
  return current;
}

function pageTitlePartsFromIds(
  value: CellValue,
  pages: ReturnType<typeof usePageStore.getState>["pages"],
  opts?: { knownOnly?: boolean; requireAllKnown?: boolean },
): { titles: string[]; rest: number } | null {
  const rawIds = stringArrayValue(value);
  if (rawIds.length === 0) return null;
  const knownIds = rawIds.filter((id) => pages[id]);
  if (opts?.requireAllKnown && knownIds.length !== rawIds.length) return null;
  const ids = opts?.knownOnly || opts?.requireAllKnown ? knownIds : rawIds;
  if (ids.length === 0) return null;
  return {
    titles: ids
      .map((id) => pages[id]?.title?.trim() || "제목 없음")
      .slice(0, 2),
    rest: Math.max(0, ids.length - 2),
  };
}

export function DatabaseCellDisplay({
  column,
  value,
  textClassName,
  rowId,
}: Props) {
  const databases = useDatabaseStore((s) => s.databases);
  const pages = usePageStore((s) => s.pages);
  const members = useMemberStore((s) => s.members);
  const usingSourceDisplay = Boolean(column.config?.sourceFromDb);
  const displayColumn = usingSourceDisplay
    ? resolveSourceDisplayColumn(column, databases)
    : column;
  // sourceFromDb 또는 linkedScope 가 설정된 select/multiSelect/status 컬럼은 외부 소스 옵션 사용
  const options = useEffectiveOptions(displayColumn);
  // viaPageLinkColumnId 미러 — 연결된 페이지의 셀값 자동 사용
  const rowCells = rowId ? pages[rowId]?.dbCells : undefined;
  const derived = resolveDerivedCellValue(column, rowCells, pages, {
    currentRowPageId: rowId,
    databases,
  });
  const usesManualAutomationValue = shouldUseManualCellValueForAutomation(column, derived);
  const effectiveValue: CellValue = isCellValueDerived(column) && !usesManualAutomationValue
    ? ((derived as CellValue) ?? null)
    : value;
  // 이후 로직은 effectiveValue 기반
  value = effectiveValue;
  column = displayColumn;

  if (column.type === "status") {
    const raw = typeof value === "string" ? value : "";
    const current = options.find((option) => option.id === raw) ?? options[0];
    return current ? <OptionChip option={current} columnType="status" /> : null;
  }

  if (column.type === "select") {
    const raw = typeof value === "string" ? value : "";
    const current = options.find((option) => option.id === raw);
    return current ? <OptionChip option={current} columnType="select" /> : null;
  }

  if (column.type === "multiSelect") {
    const ids = stringArrayValue(value);
    const selected = options.filter((option) => ids.includes(option.id));
    if (selected.length === 0) return null;
    return (
      <span className="inline-flex max-w-full flex-wrap items-center gap-1">
        {selected.map((option) => (
          <OptionChip
            key={option.id}
            option={option}
            columnType="multiSelect"
          />
        ))}
      </span>
    );
  }

  if (column.type === "dbLink") {
    const dbId = typeof value === "string" ? value : null;
    const db = dbId ? databases[dbId] : null;
    if (!db) return null;
    return (
      <span className={textClassName ?? "text-zinc-500 dark:text-zinc-400"}>
        {db.meta.title || "제목 없음"}
      </span>
    );
  }

  if (column.type === "person") {
    const personValue = typeof value === "string"
      ? value
      : Array.isArray(value)
        ? stringArrayValue(value)
        : null;
    const ids = normalizePersonValue(personValue);
    if (ids.length === 0) return null;
    // 편집 셀(PersonCell)과 동일하게 실제 멤버 이름 컬러 칩으로 표시한다.
    // 색상은 편집 셀과 맞추기 위해 원본 값(id) 기준, 라벨은 멤버 이름으로 해석한다.
    return (
      <span className="inline-flex max-w-full flex-wrap items-center gap-1">
        {ids.map((id, idx) => {
          const member = members.find((candidate) => candidate.memberId === id);
          const label = member?.name.trim() || member?.email.trim() || id;
          return (
            <span
              key={`${id}-${idx}`}
              className="inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium text-white"
              style={{ backgroundColor: personChipColor(id) }}
            >
              {label}
            </span>
          );
        })}
      </span>
    );
  }

  if (column.type === "pageLink") {
    const mirrorValue = rowId && !usingSourceDisplay
      ? resolvePageLinkMirrorValue({
          databases,
          pages,
          currentDatabaseId: pages[rowId]?.databaseId,
          rowId,
          column,
        })
      : undefined;
    const sourceValue = mirrorValue ?? value;
    const pageTitles = pageTitlePartsFromIds(sourceValue, pages);
    if (!pageTitles) return null;
    return (
      <span className={textClassName ?? "text-zinc-500 dark:text-zinc-400"}>
        {pageTitles.titles.join(", ")}{pageTitles.rest > 0 ? ` 외 ${pageTitles.rest}개` : ""}
      </span>
    );
  }

  if (column.type === "itemFetch") {
    const resolvedPageTitles = pageTitlePartsFromIds(value, pages, { knownOnly: true });
    if (resolvedPageTitles) {
      return (
        <span className={textClassName ?? "text-zinc-500 dark:text-zinc-400"}>
          {resolvedPageTitles.titles.join(", ")}{resolvedPageTitles.rest > 0 ? ` 외 ${resolvedPageTitles.rest}개` : ""}
        </span>
      );
    }
    const sourceDbId = column.config?.itemFetchSourceDatabaseId;
    const matchColId = column.config?.itemFetchMatchColumnId;
    if (!sourceDbId || !matchColId || !rowId) return null;
    const sourceDb = databases[sourceDbId];
    if (!sourceDb) return null;
    const currentTitle = pages[rowId]?.title ?? "";
    const matchCol = sourceDb.columns.find((c) => c.id === matchColId);
    const isPageLinkCol = matchCol?.type === "pageLink";
    const titles = sourceDb.rowPageOrder
      .map((pid) => pages[pid])
      .filter((page): page is NonNullable<typeof page> => {
        if (!page) return false;
        const cv = page.dbCells?.[matchColId];
        if (isPageLinkCol) return Array.isArray(cv) && (cv as string[]).includes(rowId);
        return typeof cv === "string" && cv === currentTitle;
      })
      .map((p) => p.title || "제목 없음")
      .slice(0, 2);
    if (titles.length === 0) return null;
    return (
      <span className={textClassName ?? "text-zinc-500 dark:text-zinc-400"}>
        {titles.join(", ")}
      </span>
    );
  }

  if (usingSourceDisplay) {
    const sourcePageTitles = pageTitlePartsFromIds(value, pages, { knownOnly: true });
    if (sourcePageTitles) {
      return (
        <span className={textClassName ?? "text-zinc-500 dark:text-zinc-400"}>
          {sourcePageTitles.titles.join(", ")}{sourcePageTitles.rest > 0 ? ` 외 ${sourcePageTitles.rest}개` : ""}
        </span>
      );
    }
  }

  if (column.type === "progress") {
    // progressSource가 설정되어 있으면 자동 계산값으로 표시
    const computed = computeProgressFromSource(column, databases, pages, { currentRowPageId: rowId });
    const rawPct =
      computed !== null
        ? computed
        : typeof value === "number"
          ? value
          : 0;
    const pct = Math.min(100, Math.max(0, Math.round(rawPct)));
    return (
      <div className="flex w-full items-center gap-2 px-1">
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
          <div className="h-full rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
        </div>
        <span className="w-8 shrink-0 text-right text-xs text-zinc-500 dark:text-zinc-400">{pct}%</span>
      </div>
    );
  }

  if (column.type !== "json" && column.type !== "file") {
    const implicitPageTitles = pageTitlePartsFromIds(value, pages, { requireAllKnown: true });
    if (implicitPageTitles) {
      return (
        <span className={textClassName ?? "text-zinc-500 dark:text-zinc-400"}>
          {implicitPageTitles.titles.join(", ")}{implicitPageTitles.rest > 0 ? ` 외 ${implicitPageTitles.rest}개` : ""}
        </span>
      );
    }
  }

  const display = formatPlainDisplay(value, column);
  if (!display) return null;
  return (
    <span className={textClassName ?? "text-zinc-500 dark:text-zinc-400"}>
      {display}
    </span>
  );
}
