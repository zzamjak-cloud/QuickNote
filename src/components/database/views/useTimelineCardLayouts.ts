import { useCallback, useMemo } from "react";
import type { DatabaseRowView } from "../../../types/database";
import {
  timelineClampToWeekday as clampToWeekday,
  timelineGetRange as getRange,
} from "../../../lib/database/timelineGeometry";
import { resolveTimelineCardColor } from "../../../lib/database/timelineCardColor";
import { fmtDate } from "../../../lib/database/timelineDateUtils";
import { makeTimelineCardId, timelineCardTitle } from "./timelineCardUtils";
import { rectsIntersect } from "./timelineSelectionGeometry";
import {
  ROW_HEIGHT,
  ROW_GAP,
  UNSCHEDULED_CARD_LEFT,
  UNSCHEDULED_CARD_WIDTH,
} from "./timelineLayoutConstants";
import type { TimelineAxisScale } from "./useTimelineAxis";
import type { TimelineBoxRect, TimelineCardLayout, TimelineDateEntry } from "./timelineTypes";

// DatabaseTimelineView 카드 레이아웃 파생 — 순수 useMemo(부수효과·ref·DOM 없음).
// 가상화(renderedRows/virtualRows.start)·축 계산 결과를 입력으로 받아 카드 배치 배열을 만든다.
// 본체 useMemo/useCallback 의 로직·의존성 배열을 그대로 옮겨 동작을 보존한다.
export function useTimelineCardLayouts(params: {
  timelineDateEntries: TimelineDateEntry[];
  renderedRows: DatabaseRowView[];
  virtualRowsStart: number;
  axis: TimelineAxisScale;
  pxPerDay: number;
  dayToX: (t: number) => number;
  dayWidth: (start: number, end: number) => number;
  isWeekAxis: boolean;
  usesFitAxis: boolean;
  usesScrollableAxis: boolean;
  trackPxWidth: number;
  visibleTimelineColumnIdSet: Set<string> | null;
}): {
  cardLayouts: TimelineCardLayout[];
  getCardsInRect: (rect: TimelineBoxRect) => Set<string>;
} {
  const {
    timelineDateEntries,
    renderedRows,
    virtualRowsStart,
    axis,
    pxPerDay,
    dayToX,
    dayWidth,
    isWeekAxis,
    usesFitAxis,
    usesScrollableAxis,
    trackPxWidth,
    visibleTimelineColumnIdSet,
  } = params;

  const cardLayouts = useMemo<TimelineCardLayout[]>(() => {
    if (timelineDateEntries.length === 0) return [];
    if (usesFitAxis && (!Number.isFinite(pxPerDay) || pxPerDay <= 0)) return [];
    const layouts: TimelineCardLayout[] = [];
    const trackWidth = usesScrollableAxis ? axis.totalW : trackPxWidth;
    const unscheduledWidth = Math.max(
      96,
      Math.min(
        UNSCHEDULED_CARD_WIDTH,
        trackWidth > 0
          ? Math.max(96, trackWidth - UNSCHEDULED_CARD_LEFT - 8)
          : UNSCHEDULED_CARD_WIDTH,
      ),
    );
    for (const [localIdx, row] of renderedRows.entries()) {
      const rIdx = virtualRowsStart + localIdx;
      let rowHasScheduledCard = false;
      for (const entry of timelineDateEntries) {
        const range = getRange(row.cells[entry.columnId]);
        if (!range) continue;
        const cardTitle = timelineCardTitle(row, entry);
        let visStart = Math.max(range.start, axis.minT);
        let visEnd = Math.min(range.end, axis.maxT);
        if (visEnd < axis.minT || visStart > axis.maxT) continue;
        if (isWeekAxis) {
          const clamped = clampToWeekday(visStart, visEnd);
          if (!clamped) continue;
          visStart = clamped.start;
          visEnd = clamped.end;
        }
        const left = dayToX(visStart);
        const width = Math.max(dayWidth(visStart, visEnd), 24);
        const dateLabel = `${fmtDate(range.start)} ~ ${fmtDate(range.end)}`;
        layouts.push({
          id: makeTimelineCardId(row.pageId, entry.columnId),
          row,
          pageId: row.pageId,
          columnId: entry.columnId,
          columnName: entry.columnName,
          title: cardTitle,
          color: resolveTimelineCardColor(row.cells, entry.columnId, entry.color),
          start: visStart,
          end: visEnd,
          left,
          width,
          top: rIdx * (ROW_HEIGHT + ROW_GAP) + 2,
          dateLabel,
          showDateLabel: visibleTimelineColumnIdSet ? visibleTimelineColumnIdSet.has(entry.columnId) : true,
          tooltipText: `${cardTitle} · ${entry.columnName} (${dateLabel})`,
        });
        rowHasScheduledCard = true;
      }
      // 날짜가 하나도 지정되지 않은 행 → 미등록(흰색) 카드 1개를 항목열 우측에 표시한다.
      // (날짜 컬럼이 여러 개여도 항상 표시 — LC 스케줄러 타임라인과 동일 동작)
      if (!rowHasScheduledCard) {
        const entry =
          timelineDateEntries.find((e) => e.isPrimary) ?? timelineDateEntries[0];
        if (entry) {
          const cardTitle = timelineCardTitle(row, entry);
          const dateLabel = "날짜 없음";
          layouts.push({
            id: makeTimelineCardId(row.pageId, entry.columnId),
            row,
            pageId: row.pageId,
            columnId: entry.columnId,
            columnName: entry.columnName,
            title: cardTitle,
            color: resolveTimelineCardColor(row.cells, entry.columnId, entry.color),
            start: axis.minT,
            end: axis.minT,
            left: UNSCHEDULED_CARD_LEFT,
            width: unscheduledWidth,
            top: rIdx * (ROW_HEIGHT + ROW_GAP) + 2,
            dateLabel,
            showDateLabel: visibleTimelineColumnIdSet ? visibleTimelineColumnIdSet.has(entry.columnId) : true,
            tooltipText: `${cardTitle} · ${entry.columnName} (${dateLabel})`,
            isUnscheduled: true,
          });
        }
      }
    }
    return layouts;
  }, [
    axis.maxT,
    axis.minT,
    axis.totalW,
    dayToX,
    dayWidth,
    isWeekAxis,
    pxPerDay,
    renderedRows,
    timelineDateEntries,
    trackPxWidth,
    usesFitAxis,
    usesScrollableAxis,
    visibleTimelineColumnIdSet,
    virtualRowsStart,
  ]);

  const getCardsInRect = useCallback(
    (rect: TimelineBoxRect) => {
      const left = Math.min(rect.startX, rect.endX);
      const right = Math.max(rect.startX, rect.endX);
      const top = Math.min(rect.startY, rect.endY);
      const bottom = Math.max(rect.startY, rect.endY);
      const next = new Set<string>();
      for (const card of cardLayouts) {
        if (
          rectsIntersect(
            left,
            right,
            top,
            bottom,
            card.left,
            card.left + card.width,
            card.top,
            card.top + ROW_HEIGHT - 4,
          )
        ) {
          next.add(card.id);
        }
      }
      return next;
    },
    [cardLayouts],
  );

  return { cardLayouts, getCardsInRect };
}
