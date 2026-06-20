import type { Dispatch, SetStateAction } from "react";
import { ChevronLeft, ChevronRight, SlidersHorizontal, ZoomIn, ZoomOut } from "lucide-react";
import type { Granularity } from "./timelineTypes";
import { addMonths, monthLabel } from "../../../lib/database/timelineDateUtils";
import { CELL_WIDTH_MIN, CELL_WIDTH_MAX, CELL_WIDTH_STEP } from "./timelineZoom";

// DatabaseTimelineView 상단 컨트롤 바 — 단위(연/월/주) 토글, 카드 설정 토글,
// 월/연 이동, 오늘 이동, (연간 전용) 셀 너비 줌. 순수 표현 컴포넌트로 상태/핸들러는 props.
type Props = {
  granularity: Granularity;
  setGranularity: Dispatch<SetStateAction<Granularity>>;
  dateColsCount: number;
  timelineSettingsOpen: boolean;
  setTimelineSettingsOpen: Dispatch<SetStateAction<boolean>>;
  isMonthAxis: boolean;
  isYearAxis: boolean;
  isWeekAxis: boolean;
  visibleMonthStart: number;
  setVisibleMonthStart: Dispatch<SetStateAction<number>>;
  visibleYear: number;
  setVisibleYear: Dispatch<SetStateAction<number>>;
  cellWidthOverride: number;
  setCellWidthOverride: Dispatch<SetStateAction<number>>;
  scrollToToday: () => void;
};

export function TimelineControlBar({
  granularity,
  setGranularity,
  dateColsCount,
  timelineSettingsOpen,
  setTimelineSettingsOpen,
  isMonthAxis,
  isYearAxis,
  isWeekAxis,
  visibleMonthStart,
  setVisibleMonthStart,
  visibleYear,
  setVisibleYear,
  cellWidthOverride,
  setCellWidthOverride,
  scrollToToday,
}: Props) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
      <div className="inline-flex overflow-hidden rounded border border-zinc-300 dark:border-zinc-600">
        {(["year", "month", "week"] as Granularity[]).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setGranularity(g)}
            className={[
              "px-2 py-1 text-sm",
              granularity === g
                ? "bg-blue-500 text-white"
                : "bg-white text-zinc-600 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800",
            ].join(" ")}
          >
            {g === "year" ? "연" : g === "month" ? "월" : "주"}
          </button>
        ))}
      </div>
      {dateColsCount > 0 && (
        <div className="inline-flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setTimelineSettingsOpen((open) => !open)}
            className={[
              "flex h-7 w-7 items-center justify-center rounded text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
              timelineSettingsOpen ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100" : "",
            ].join(" ")}
            title="타임라인 날짜 카드 설정"
            aria-label="타임라인 날짜 카드 설정"
            aria-pressed={timelineSettingsOpen}
          >
            <SlidersHorizontal size={14} />
          </button>
        </div>
      )}
      {isMonthAxis && (
        <div className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={() => setVisibleMonthStart((prev) => addMonths(prev, -1))}
            className="flex h-7 w-7 items-center justify-center rounded text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            title="이전 월"
            aria-label="이전 월"
          >
            <ChevronLeft size={15} />
          </button>
          <span className="min-w-[7.5rem] text-center text-sm font-medium text-zinc-700 dark:text-zinc-200">
            {monthLabel(visibleMonthStart)}
          </span>
          <button
            type="button"
            onClick={() => setVisibleMonthStart((prev) => addMonths(prev, 1))}
            className="flex h-7 w-7 items-center justify-center rounded text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            title="다음 월"
            aria-label="다음 월"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      )}
      {isYearAxis && (
        <div className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={() => setVisibleYear((prev) => prev - 1)}
            className="flex h-7 w-7 items-center justify-center rounded text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            title="이전 연도"
            aria-label="이전 연도"
          >
            <ChevronLeft size={15} />
          </button>
          <span className="min-w-[4rem] text-center text-sm font-medium text-zinc-700 dark:text-zinc-200">
            {visibleYear}년
          </span>
          <button
            type="button"
            onClick={() => setVisibleYear((prev) => prev + 1)}
            className="flex h-7 w-7 items-center justify-center rounded text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            title="다음 연도"
            aria-label="다음 연도"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      )}
      {/* 오늘 이동 + (연간 전용) 셀 너비 줌 컨트롤 */}
      {!isWeekAxis && (
        <>
          <button
            type="button"
            onClick={scrollToToday}
            className="ml-auto rounded px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            오늘
          </button>
          {isYearAxis && (
          <div className="inline-flex items-center gap-1 rounded border border-zinc-300 px-1 dark:border-zinc-600">
          <button
            type="button"
            onClick={() => setCellWidthOverride((w) => Math.max(CELL_WIDTH_MIN, w - CELL_WIDTH_STEP))}
            disabled={cellWidthOverride <= CELL_WIDTH_MIN}
            title="축소"
            className="rounded p-0.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
          >
            <ZoomOut size={13} />
          </button>
          <span className="min-w-[2.5rem] text-center text-sm text-zinc-500">{cellWidthOverride}px</span>
          <button
            type="button"
            onClick={() => setCellWidthOverride((w) => Math.min(CELL_WIDTH_MAX, w + CELL_WIDTH_STEP))}
            disabled={cellWidthOverride >= CELL_WIDTH_MAX}
            title="확대"
            className="rounded p-0.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
          >
            <ZoomIn size={13} />
          </button>
          </div>
          )}
        </>
      )}
    </div>
  );
}
