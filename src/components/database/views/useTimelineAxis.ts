/* eslint-disable react-hooks/purity -- 축/오늘 기준선은 렌더 시각의 Date.now() 사용 */
import { useCallback, useMemo } from "react";
import {
  DAY_MS,
  TIMELINE_WEEK_CAL_DAYS as WEEK_CAL_DAYS,
  TIMELINE_WEEK_RANGE_DAYS as WEEK_RANGE_DAYS,
  timelineStartOfDay as startOfDay,
  timelineStartOfWeekMon as startOfWeekMon,
  timelineWeekLabel as weekLabel,
  timelineWeekdayIndex as weekdayIndex,
} from "../../../lib/database/timelineGeometry";
import { endOfMonth } from "../../../lib/database/timelineDateUtils";
import type { Granularity } from "./timelineTypes";

export type HeaderTick = {
  x: number;
  label: string;
  major?: boolean;
  width?: number;
  widthPct?: number;
  align?: "left" | "center";
};

export type TimelineAxisScale = {
  minT: number;
  maxT: number;
  totalDays: number;
  cellWidth: number;
  totalW: number;
};

export type TimelineAxis = {
  isYearAxis: boolean;
  isWeekAxis: boolean;
  isMonthAxis: boolean;
  usesScrollableAxis: boolean;
  usesFitAxis: boolean;
  axis: TimelineAxisScale;
  pxPerDay: number;
  dayToX: (t: number) => number;
  dayWidth: (start: number, end: number) => number;
  headerTicks: HeaderTick[];
  weekendStrips: { x: number }[];
  todayX: number;
};

// DatabaseTimelineView 의 순수 축 스케일/틱 계산 — DOM 읽기·스크롤·ref·모듈상태와 무관.
// (getTodayScrollLeft 등 DOM 의존 계산은 컴포넌트에 남아 이 hook 의 출력을 소비한다.)
// 본체 useMemo/useCallback 의 의존성 배열·로직을 그대로 옮겨 동작을 보존한다.
export function useTimelineAxis(params: {
  granularity: Granularity;
  visibleMonthStart: number;
  visibleYear: number;
  cellWidthOverride: number;
  trackPxWidth: number;
}): TimelineAxis {
  const { granularity, visibleMonthStart, visibleYear, cellWidthOverride, trackPxWidth } = params;

  const isYearAxis = granularity === "year";
  const isWeekAxis = granularity === "week";
  const isMonthAxis = granularity === "month";
  const usesScrollableAxis = isYearAxis;
  const usesFitAxis = !usesScrollableAxis;

  const axis = useMemo(() => {
    if (granularity === "week") {
      const thisWeekStart = startOfWeekMon(Date.now());
      const minT = thisWeekStart - WEEK_CAL_DAYS * DAY_MS;
      const maxT = minT + (2 * WEEK_CAL_DAYS + 4) * DAY_MS;
      const totalDays = WEEK_RANGE_DAYS;
      return { minT, maxT, totalDays, cellWidth: 0, totalW: 0 };
    }
    let minT: number;
    let maxT: number;
    if (granularity === "month") {
      minT = visibleMonthStart;
      maxT = endOfMonth(visibleMonthStart);
    } else {
      // 연간 축 — 해당 연도 1/1 ~ 12/31 전체를 일자 셀로 스크롤 표시 (LC 스케줄러와 동일).
      minT = startOfDay(new Date(visibleYear, 0, 1).getTime());
      maxT = startOfDay(new Date(visibleYear, 11, 31).getTime());
    }
    const totalDays = Math.max(1, Math.round((maxT - minT) / DAY_MS) + 1);
    const cellWidth = granularity === "month" ? 0 : cellWidthOverride;
    const totalW = totalDays * cellWidth;
    return { minT, maxT, totalDays, cellWidth, totalW };
  }, [cellWidthOverride, granularity, visibleMonthStart, visibleYear]);

  const pxPerDay =
    isWeekAxis
      ? trackPxWidth / WEEK_RANGE_DAYS
      : usesFitAxis
        ? trackPxWidth / axis.totalDays
        : axis.cellWidth;

  const dayToX = useCallback((t: number): number => {
    if (isWeekAxis) {
      const idx = weekdayIndex(t, axis.minT);
      if (idx < 0) return 0;
      return Math.round(idx * pxPerDay);
    }
    return Math.round(((t - axis.minT) / DAY_MS) * pxPerDay);
  }, [axis.minT, isWeekAxis, pxPerDay]);

  const dayWidth = useCallback((start: number, end: number): number => {
    if (isWeekAxis) {
      const sIdx = weekdayIndex(start, axis.minT);
      const eIdx = weekdayIndex(end, axis.minT);
      if (sIdx < 0 || eIdx < 0) return pxPerDay;
      const days = eIdx - sIdx + 1;
      return Math.max(pxPerDay, days * pxPerDay);
    }
    const days = Math.round((end - start) / DAY_MS) + 1;
    return Math.max(pxPerDay, days * pxPerDay);
  }, [axis.minT, isWeekAxis, pxPerDay]);

  const headerTicks: HeaderTick[] = [];
  const weekendStrips: { x: number }[] = [];
  if (isWeekAxis) {
    const labels = ["지난 주", "이번 주", "다음 주"];
    for (let i = 0; i < 3; i++) {
      const wkStart = axis.minT + i * WEEK_CAL_DAYS * DAY_MS;
      headerTicks.push({
        x: 0,
        label: `${labels[i]} (${weekLabel(wkStart)})`,
        major: i === 1,
        widthPct: 100 / 3,
      });
    }
  } else if (isMonthAxis) {
    for (let i = 0; i < axis.totalDays; i++) {
      const t = axis.minT + i * DAY_MS;
      const d = new Date(t);
      const dow = d.getDay();
      headerTicks.push({
        x: dayToX(t),
        label: String(d.getDate()),
        major: d.getDate() === 1 || dow === 1,
        width: Math.max(1, pxPerDay),
      });
      if (dow === 0 || dow === 6) {
        weekendStrips.push({ x: dayToX(t) });
      }
    }
  } else {
    for (let i = 0; i < axis.totalDays; i++) {
      const t = axis.minT + i * DAY_MS;
      const d = new Date(t);
      const dow = d.getDay();
      headerTicks.push({
        x: i * axis.cellWidth,
        label: `${d.getMonth() + 1}/${d.getDate()}`,
        major: d.getDate() === 1,
      });
      if (dow === 0 || dow === 6) {
        weekendStrips.push({ x: i * axis.cellWidth });
      }
    }
  }

  const todayX =
    isWeekAxis
      ? (() => {
          const idx = weekdayIndex(Date.now(), axis.minT);
          if (idx < 0 || !Number.isFinite(pxPerDay) || pxPerDay <= 0) return -1;
          return Math.round(idx * pxPerDay);
        })()
      : dayToX(startOfDay(Date.now()));

  return {
    isYearAxis,
    isWeekAxis,
    isMonthAxis,
    usesScrollableAxis,
    usesFitAxis,
    axis,
    pxPerDay,
    dayToX,
    dayWidth,
    headerTicks,
    weekendStrips,
    todayX,
  };
}
