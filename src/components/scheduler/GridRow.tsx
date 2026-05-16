// 멤버 행 배경 — 주말/공휴일/오늘/월 경계선을 절대위치 오버레이로 표시.
import { useMemo } from "react";
import {
  daysInYear,
  weekendIndices,
  firstDayOfMonthIndices,
  todayIndex as calcTodayIndex,
  startOfYear,
} from "../../lib/scheduler/dateUtils";
import { getHolidaysForYear } from "../../lib/scheduler/koreanHolidays";
import { useSchedulerHolidaysStore } from "../../store/schedulerHolidaysStore";

type RangeSpan = { start: number; end: number };

// 연속된 인덱스를 {start, end} 범위로 병합
function mergeConsecutiveIndices(indices: number[]): RangeSpan[] {
  if (indices.length === 0) return [];
  const sorted = [...indices].sort((a, b) => a - b);
  const result: RangeSpan[] = [];
  let start = sorted[0] as number;
  let end = sorted[0] as number;
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i] as number;
    if (cur === end + 1) {
      end = cur;
    } else {
      result.push({ start, end: end + 1 });
      start = cur;
      end = cur;
    }
  }
  result.push({ start, end: end + 1 });
  return result;
}

type Props = {
  year: number;
  cellWidth: number;
  weekendColor: string;
};

export function GridRow({ year, cellWidth, weekendColor }: Props) {
  const total = daysInYear(year);
  const totalWidth = total * cellWidth;
  const yearStart = startOfYear(year);

  const weekends = useMemo(() => weekendIndices(year), [year]);
  const monthBoundaries = useMemo(() => firstDayOfMonthIndices(year), [year]);
  const todayIdx = calcTodayIndex(year);

  // 사용자 등록 공휴일 (store)
  const storeHolidays = useSchedulerHolidaysStore((s) => s.holidays);

  // 공식 공휴일 + 사용자 등록 공휴일 합집합 → dayIndex Set
  const holidayIdxSet = useMemo(() => {
    const set = new Set<number>();

    // 공식 공휴일
    for (const h of getHolidaysForYear(year)) {
      const d = new Date(h.date + 'T00:00:00');
      const idx = Math.round((d.getTime() - yearStart.getTime()) / 86400000);
      if (idx >= 0 && idx < total) set.add(idx);
    }

    // 사용자 등록 공휴일 (type === 'holiday')
    for (const h of storeHolidays) {
      if (!h.date.startsWith(String(year))) continue;
      const d = new Date(h.date + 'T00:00:00');
      const idx = Math.round((d.getTime() - yearStart.getTime()) / 86400000);
      if (idx >= 0 && idx < total) set.add(idx);
    }

    return set;
  }, [year, yearStart, total, storeHolidays]);

  // 주말과 공휴일 합집합을 연속 범위로 병합
  const combinedRanges = useMemo(() => {
    const allIndices = [...weekends];
    for (const idx of holidayIdxSet) {
      if (!weekends.includes(idx)) allIndices.push(idx);
    }
    return mergeConsecutiveIndices(allIndices);
  }, [weekends, holidayIdxSet]);

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ width: totalWidth }}>
      {/* 주말+공휴일 배경 — 연속 범위를 단일 div 로 */}
      {combinedRanges.map(({ start, end }) => (
        <div
          key={`we-${start}`}
          className="absolute top-0 bottom-0"
          style={{
            left: start * cellWidth,
            width: (end - start) * cellWidth,
            backgroundColor: weekendColor,
          }}
        />
      ))}

      {/* 월 경계선 (첫 날 제외) */}
      {monthBoundaries.slice(1).map((idx) => (
        <div
          key={`mb-${idx}`}
          className="absolute top-0 bottom-0"
          style={{
            left: idx * cellWidth,
            width: 2,
            borderLeft: "2px dashed rgba(0,0,0,0.10)",
          }}
        />
      ))}

      {/* 오늘 표시 — 세로 바 (주간 뷰와 동일한 파란색) */}
      {todayIdx !== null && (
        <div
          className="absolute top-0 bottom-0 bg-blue-500 pointer-events-none"
          style={{
            left: todayIdx * cellWidth + cellWidth / 2 - 2,
            width: 4,
            boxShadow: "0 0 8px rgba(59,130,246,0.6)",
          }}
        />
      )}
    </div>
  );
}
