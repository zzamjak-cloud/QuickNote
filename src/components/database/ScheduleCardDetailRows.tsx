// 모든 일정 카드(LC 스케줄러 + 일반 DB 타임라인) 공용 호버 툴팁 상세 행.
// 카드 라벨과 동일하게 viewConfigs.timeline 표시 설정을 따르되, 툴팁은 "컬럼명: 값" 세로 목록으로 렌더한다.
import { useMemo } from "react";
import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";
import {
  getVisibleOrderedColumns,
  isInternalHiddenColumnId,
  type ViewConfigsMap,
} from "../../types/database";
import { DatabaseCellDisplay } from "./DatabaseCellDisplay";
import {
  databaseCellHasDisplayValue,
  databaseColumnMayHaveDerivedDisplayValue,
} from "./databaseCellDisplayUtils";

type Props = {
  databaseId: string | undefined;
  pageId: string | undefined;
  /** 라벨에서 제외할 컬럼 id (타임라인 막대용 활성 날짜 컬럼) */
  excludeColumnIds?: readonly string[];
  /** 모든 날짜(date) 타입 컬럼 제외 (작업 카드 기간 컬럼) */
  excludeDateColumns?: boolean;
  /** 표시 설정 출처. 미지정 시 DB 번들의 panelState.viewConfigs 를 사용. */
  viewConfigs?: ViewConfigsMap;
};

/**
 * 표시 컬럼은 DB의 viewConfigs.timeline 설정을 그대로 따른다(설정 없으면 전체 표시).
 * 제목·내부 전용 컬럼·excludeColumnIds·(옵션)날짜 컬럼은 제외한다.
 */
export function ScheduleCardDetailRows({
  databaseId,
  pageId,
  excludeColumnIds,
  excludeDateColumns = false,
  viewConfigs,
}: Props) {
  const page = usePageStore((s) => (pageId ? s.pages[pageId] : undefined));
  const bundle = useDatabaseStore((s) => (databaseId ? s.databases[databaseId] : undefined));
  const effectiveViewConfigs = viewConfigs ?? bundle?.panelState?.viewConfigs;

  const exclude = useMemo(() => new Set(excludeColumnIds ?? []), [excludeColumnIds]);
  const cols = useMemo(() => {
    if (!bundle) return [];
    return getVisibleOrderedColumns(bundle.columns, "timeline", effectiveViewConfigs).filter(
      (column) =>
        column.type !== "title" &&
        !isInternalHiddenColumnId(column.id) &&
        !exclude.has(column.id) &&
        !(excludeDateColumns && column.type === "date"),
    );
  }, [bundle, effectiveViewConfigs, exclude, excludeDateColumns]);

  const cells = page?.dbCells ?? {};
  const visibleCols = cols.filter(
    (column) =>
      databaseCellHasDisplayValue(cells[column.id], column) ||
      databaseColumnMayHaveDerivedDisplayValue(column),
  );

  if (!pageId || visibleCols.length === 0) return null;

  return (
    <div className="mt-1.5 flex flex-col gap-1 border-t border-zinc-100 pt-1.5 dark:border-zinc-700">
      {visibleCols.map((column) => (
        <div key={column.id} className="flex items-baseline gap-2">
          <span className="w-14 shrink-0 text-[10px] text-zinc-400 dark:text-zinc-500">
            {column.name}
          </span>
          <span className="min-w-0 flex-1 text-xs text-zinc-700 dark:text-zinc-200">
            <DatabaseCellDisplay
              column={column}
              value={cells[column.id]}
              rowId={pageId}
              textClassName="text-zinc-700 dark:text-zinc-200"
            />
          </span>
        </div>
      ))}
    </div>
  );
}
