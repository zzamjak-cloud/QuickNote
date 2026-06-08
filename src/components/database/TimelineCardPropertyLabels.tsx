// 모든 일정 카드(LC 스케줄러 작업·마일스톤·피처 + 일반 DB 타임라인) 공용 보조 속성 라벨.
// 원본 DB 행의 cells + viewConfigs.timeline 표시 설정대로 컬럼을 나열하고,
// 개별 속성은 잘리지 않은 채(`whitespace-nowrap`) 카드 너비에서만 클리핑한다.
import { useMemo, type CSSProperties } from "react";
import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";
import {
  getVisibleOrderedColumns,
  isInternalHiddenColumnId,
  type CellValue,
  type ViewConfigsMap,
} from "../../types/database";
import { DatabaseCellDisplay } from "./DatabaseCellDisplay";
import {
  databaseCellHasDisplayValue,
  databaseColumnMayHaveDerivedDisplayValue,
} from "./databaseCellDisplayUtils";

type Props = {
  /** 행이 속한 DB id */
  databaseId: string | undefined;
  /** 행 페이지 id (셀 값·DatabaseCellDisplay rowId) */
  pageId: string | undefined;
  /** 타임라인 막대로 쓰여 라벨에서 제외할 컬럼 id (보통 활성 날짜 컬럼) */
  excludeColumnIds?: readonly string[];
  /** 모든 날짜(date) 타입 컬럼을 라벨에서 제외할지 여부 (작업 카드의 기간 컬럼 등) */
  excludeDateColumns?: boolean;
  /** 표시 설정 출처. 미지정 시 DB 번들의 panelState.viewConfigs 를 사용한다.
   *  (일반 DB 타임라인은 prop 으로 받은 panelState 가 진실이므로 명시 전달) */
  viewConfigs?: ViewConfigsMap;
  /** pageStore에 아직 없는 cached-only row 표시용 셀 fallback */
  fallbackDbCells?: Record<string, CellValue>;
  /** 라벨 묶음 wrapper 클래스 (색상·폰트 크기 등) */
  className?: string;
  /** 라벨 묶음 wrapper 인라인 스타일 (예: 카드 텍스트 색) */
  style?: CSSProperties;
  /** 각 셀 표시 텍스트 클래스 */
  textClassName?: string;
};

/**
 * 표시 컬럼은 DB의 viewConfigs.timeline 설정을 그대로 따른다(설정 없으면 전체 표시).
 * 제목·내부 전용 컬럼·excludeColumnIds·(옵션)날짜 컬럼은 항상 제외한다.
 */
export function TimelineCardPropertyLabels({
  databaseId,
  pageId,
  excludeColumnIds,
  excludeDateColumns = false,
  className,
  style,
  textClassName = "",
  viewConfigs,
  fallbackDbCells,
}: Props) {
  const page = usePageStore((s) => (pageId ? s.pages[pageId] : undefined));
  const bundle = useDatabaseStore((s) => (databaseId ? s.databases[databaseId] : undefined));
  const effectiveViewConfigs = viewConfigs ?? bundle?.panelState?.viewConfigs;

  const exclude = useMemo(() => new Set(excludeColumnIds ?? []), [excludeColumnIds]);
  const labelCols = useMemo(() => {
    if (!bundle) return [];
    return getVisibleOrderedColumns(bundle.columns, "timeline", effectiveViewConfigs).filter(
      (column) =>
        column.type !== "title" &&
        !isInternalHiddenColumnId(column.id) &&
        !exclude.has(column.id) &&
        !(excludeDateColumns && column.type === "date"),
    );
  }, [bundle, effectiveViewConfigs, exclude, excludeDateColumns]);

  const cells = page?.dbCells ?? fallbackDbCells ?? {};
  const visibleCols = labelCols.filter(
    (column) =>
      databaseCellHasDisplayValue(cells[column.id], column) ||
      databaseColumnMayHaveDerivedDisplayValue(column),
  );

  if (!pageId || visibleCols.length === 0) return null;

  return (
    <span className={`flex shrink-0 items-center gap-1 overflow-hidden ${className ?? ""}`} style={style}>
      {visibleCols.map((column) => (
        <span key={column.id} className="shrink-0 whitespace-nowrap">
          <DatabaseCellDisplay
            column={column}
            value={cells[column.id]}
            rowId={pageId}
            textClassName={textClassName}
          />
        </span>
      ))}
    </span>
  );
}
