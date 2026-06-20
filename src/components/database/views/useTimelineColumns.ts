import { useMemo } from "react";
import type { ColumnDef, DatabasePanelState } from "../../../types/database";
import {
  getVisibleOrderedColumns,
  resolveViewColumnOrderState,
} from "../../../types/database";
import type { TimelineDateEntry } from "./timelineTypes";
import { defaultTimelineColor, isValidTimelineColor } from "./timelineCardUtils";

export type TimelineColumns = {
  dateCols: ColumnDef[];
  primaryDateCol: ColumnDef | null;
  dateColId: string | null;
  hasExplicitTimelineCards: boolean;
  timelineDateEntries: TimelineDateEntry[];
  activeTimelineColumnIds: Set<string>;
  timelineExcludeColumnIds: string[];
  visibleTimelineColumnIdSet: Set<string>;
};

// DatabaseTimelineView 의 날짜 컬럼/타임라인 카드 엔트리 파생 — 순수 useMemo 묶음(부수효과 없음).
// 입력은 columns/panelState 뿐이며 store 변이·ref·effect 는 컴포넌트에 남는다.
// 추출 시 본체 useMemo 의 의존성 배열·로직을 그대로 옮겨 동작을 보존한다.
export function useTimelineColumns(
  columns: ColumnDef[],
  panelState: DatabasePanelState,
): TimelineColumns {
  const dateCols = useMemo(() => {
    const all = columns.filter((c) => c.type === "date");
    const orderedIds = resolveViewColumnOrderState(
      columns,
      "timeline",
      panelState.viewConfigs?.timeline,
    ).orderedColumnIds;
    const rank = new Map(orderedIds.map((id, index) => [id, index]));
    return [...all].sort(
      (a, b) =>
        (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
  }, [columns, panelState.viewConfigs]);
  const primaryDateCol = useMemo(
    () => dateCols.find((c) => c.id === panelState.timelineDateColumnId) ?? dateCols[0] ?? null,
    [dateCols, panelState.timelineDateColumnId],
  );
  const dateColId = primaryDateCol?.id ?? null;
  const hasExplicitTimelineCards = useMemo(
    () => dateCols.some((c) => c.config?.timelineCard?.enabled === true),
    [dateCols],
  );
  const timelineDateEntries = useMemo<TimelineDateEntry[]>(() => {
    const activeColumns = hasExplicitTimelineCards
      ? dateCols.filter((c) => c.config?.timelineCard?.enabled === true)
      : primaryDateCol && primaryDateCol.config?.timelineCard?.enabled !== false
        ? [primaryDateCol]
        : [];
    return activeColumns.map((column, index) => {
      const config = column.config?.timelineCard;
      return {
        columnId: column.id,
        columnName: column.name,
        titleMode: config?.titleMode === "custom" ? "custom" : "pageTitle",
        title: typeof config?.title === "string" ? config.title : "",
        color: isValidTimelineColor(config?.color) ? config.color : defaultTimelineColor(index),
        isPrimary: column.id === dateColId || (!dateColId && index === 0),
      };
    });
  }, [dateColId, dateCols, hasExplicitTimelineCards, primaryDateCol]);

  const activeTimelineColumnIds = useMemo(
    () => new Set(timelineDateEntries.map((entry) => entry.columnId)),
    [timelineDateEntries],
  );

  // 모든 뷰 공통 규칙 — 설정 없으면 전체 표시. 카드 보조 라벨은 표시 컬럼에서 제목과
  // 타임라인 막대로 쓰이는 날짜 컬럼만 제외한 나머지다.
  // 카드 라벨/툴팁 공용 컴포넌트에 넘길 제외 컬럼 — 타임라인 막대로 쓰이는 활성 날짜 컬럼.
  const timelineExcludeColumnIds = useMemo(
    () => [...activeTimelineColumnIds, ...(dateColId ? [dateColId] : [])],
    [activeTimelineColumnIds, dateColId],
  );

  const visibleTimelineColumnIdSet = useMemo(
    () =>
      new Set(
        getVisibleOrderedColumns(columns, "timeline", panelState.viewConfigs).map(
          (column) => column.id,
        ),
      ),
    [columns, panelState.viewConfigs],
  );

  return {
    dateCols,
    primaryDateCol,
    dateColId,
    hasExplicitTimelineCards,
    timelineDateEntries,
    activeTimelineColumnIds,
    timelineExcludeColumnIds,
    visibleTimelineColumnIdSet,
  };
}
