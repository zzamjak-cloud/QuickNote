// 연간 그리드 상단 날짜 헤더 — 월 라벨 행 + 일자 행 2층 구조.
import { useMemo } from "react";
import {
  startOfYear,
  daysInYear,
  addDays,
  isWeekend,
  todayIndex as calcTodayIndex,
  firstDayOfMonthIndices,
} from "../../lib/scheduler/dateUtils";
import { getHolidaysForYear } from "../../lib/scheduler/koreanHolidays";
import { useSchedulerHolidaysStore } from "../../store/schedulerHolidaysStore";

type Props = {
  year: number;
  cellWidth: number;
};

type MonthInfo = {
  month: number; // 1-12
  dayCount: number;
  isFirst: boolean;
};

// 대체공휴일 이름을 "대체"로 축약 (원본 TeamScheduler 동작과 동일)
function abbreviateHolidayName(name: string): string {
  if (name.includes('대체공휴일') || name.includes('대체휴일')) return '대체';
  return name;
}

export function DateAxis({ year, cellWidth }: Props) {
  const total = daysInYear(year);
  const yearStart = startOfYear(year);
  const todayIdx = calcTodayIndex(year);
  const monthBoundaries = useMemo(() => firstDayOfMonthIndices(year), [year]);

  // 공식 공휴일 + 사용자 등록 공휴일 → dateStr → name 맵
  const storeHolidays = useSchedulerHolidaysStore((s) => s.holidays);
  const holidayNameMap = useMemo(() => {
    const map = new Map<string, string>();
    // 공식 공휴일
    for (const h of getHolidaysForYear(year)) {
      map.set(h.date, h.name);
    }
    // 사용자 등록 항목 (공식보다 우선하지 않도록 공식을 먼저 넣음)
    for (const h of storeHolidays) {
      if (h.date.startsWith(String(year)) && !map.has(h.date)) {
        map.set(h.date, h.title);
      }
    }
    return map;
  }, [year, storeHolidays]);

  // 월별 정보 계산
  const monthInfos = useMemo<MonthInfo[]>(() => {
    const infos: MonthInfo[] = [];
    for (let m = 0; m < 12; m++) {
      const start = new Date(year, m, 1);
      const end = new Date(year, m + 1, 0);
      const first = Math.floor((start.getTime() - yearStart.getTime()) / 86400000);
      const last = Math.min(
        Math.floor((end.getTime() - yearStart.getTime()) / 86400000),
        total - 1,
      );
      infos.push({
        month: m + 1,
        dayCount: last - first + 1,
        isFirst: m === 0,
      });
    }
    return infos;
  }, [year, yearStart, total]);

  // 날짜 셀 배열
  const dayCells = useMemo(() => {
    return Array.from({ length: total }, (_, i) => {
      const d = addDays(yearStart, i);
      const weekend = isWeekend(d);
      const isMonthBoundary = monthBoundaries.includes(i) && i > 0;
      const isToday = todayIdx === i;
      // YYYY-MM-DD 형식으로 날짜 문자열 생성
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const holidayName = holidayNameMap.get(dateStr) ?? null;
      return { i, d, weekend, isMonthBoundary, isToday, holidayName };
    });
  }, [total, yearStart, monthBoundaries, todayIdx, holidayNameMap]);

  const totalWidth = total * cellWidth;

  return (
    <div className="sticky top-0 z-10 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 flex-shrink-0">
      {/* 월 라벨 행 */}
      <div className="flex" style={{ width: totalWidth }}>
        {monthInfos.map((info, idx) => (
          <div
            key={info.month}
            className={`flex-shrink-0 flex items-center px-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 overflow-hidden ${
              idx % 2 === 0
                ? "bg-slate-50 dark:bg-zinc-900"
                : "bg-slate-100 dark:bg-zinc-800"
            }`}
            style={{
              width: info.dayCount * cellWidth,
              height: 24,
              borderLeft: !info.isFirst ? "2px dashed rgba(0,0,0,0.12)" : undefined,
            }}
          >
            {info.month}월
          </div>
        ))}
      </div>

      {/* 일자 행 */}
      <div className="flex" style={{ width: totalWidth }}>
        {dayCells.map(({ i, d, weekend, isMonthBoundary, isToday, holidayName }) => (
          <div
            key={i}
            className={`flex-shrink-0 flex flex-col items-center justify-center overflow-hidden ${
              isToday
                ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 font-semibold"
                : weekend
                  ? "text-red-500 dark:text-red-400"
                  : "text-zinc-500 dark:text-zinc-400"
            }`}
            style={{
              width: cellWidth,
              height: 28,
              borderLeft: isMonthBoundary ? "2px dashed rgba(0,0,0,0.12)" : undefined,
            }}
          >
            {/* 일자 숫자 */}
            <span className="text-[10px] leading-none">{d.getDate()}</span>
            {/* 공휴일 텍스트 (대체는 "대체"로 축약) */}
            {holidayName && (
              <span className="text-[9px] leading-none truncate w-full text-center text-rose-600 dark:text-rose-400">
                {abbreviateHolidayName(holidayName)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
