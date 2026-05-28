import type { CellValue, ColumnDef } from "../../types/database";
import { OptionChip } from "./cells/OptionChip";
import {
  formatPlainDisplay,
  stringArrayValue,
} from "./databaseCellDisplayUtils";
import { useDatabaseStore } from "../../store/databaseStore";
import { usePageStore } from "../../store/pageStore";
import { computeProgressFromSource, resolveDerivedCellValue } from "../../lib/database/columnSource";
import { useEffectiveOptions } from "./useEffectiveOptions";

type Props = {
  column: ColumnDef;
  value: CellValue;
  textClassName?: string;
  /** 현재 행 pageId — sourceFromDb.viaPageLinkColumnId 로 연결된 페이지에서 값 자동 미러링 시 필요 */
  rowId?: string;
};

export function DatabaseCellDisplay({
  column,
  value,
  textClassName,
  rowId,
}: Props) {
  const databases = useDatabaseStore((s) => s.databases);
  const pages = usePageStore((s) => s.pages);
  // sourceFromDb 또는 linkedScope 가 설정된 select/multiSelect/status 컬럼은 외부 소스 옵션 사용
  const options = useEffectiveOptions(column);
  // viaPageLinkColumnId 미러 — 연결된 페이지의 셀값 자동 사용
  const rowCells = rowId ? pages[rowId]?.dbCells : undefined;
  const derived = resolveDerivedCellValue(column, rowCells, pages);
  const effectiveValue: CellValue = derived !== undefined ? (derived as CellValue) : value;
  // 이후 로직은 effectiveValue 기반
  value = effectiveValue;

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

  if (column.type === "pageLink") {
    const ids = Array.isArray(value) ? (value as string[]).filter((v) => typeof v === "string") : [];
    if (ids.length === 0) return null;
    const titles = ids
      .map((id) => pages[id]?.title || "제목 없음")
      .slice(0, 2);
    const rest = ids.length - 2;
    return (
      <span className={textClassName ?? "text-zinc-500 dark:text-zinc-400"}>
        {titles.join(", ")}{rest > 0 ? ` 외 ${rest}개` : ""}
      </span>
    );
  }

  if (column.type === "progress") {
    // progressSource가 설정되어 있으면 자동 계산값으로 표시
    const computed = computeProgressFromSource(column, databases, pages, {});
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

  const display = formatPlainDisplay(value, column);
  if (!display) return null;
  return (
    <span className={textClassName ?? "text-zinc-500 dark:text-zinc-400"}>
      {display}
    </span>
  );
}
