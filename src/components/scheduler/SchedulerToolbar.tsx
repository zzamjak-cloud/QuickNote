// 스케줄러 툴바 — TeamScheduler App.tsx 툴바 JSX 1:1 포팅.
// 좌측: 연도/월/직무/이름 필터, 우측: 오늘·열너비·줌·도움말 버튼.

import {
  CalendarDays,
  Columns3,
  Minus,
  Plus,
  RotateCcw,
  ZoomOut,
  ZoomIn,
  HelpCircle,
} from "lucide-react";
import { useState } from "react";
import { useSchedulerViewStore } from "../../store/schedulerViewStore";
import { YearSelector } from "./YearSelector";
import { MonthFilter } from "./filters/MonthFilter";
import { JobTitleFilter } from "./filters/JobTitleFilter";
import { WeekViewMemberFilter } from "./filters/WeekViewMemberFilter";
import { FeatureMilestoneFilter } from "./filters/FeatureMilestoneFilter";
import { SchedulerGuideModal } from "./SchedulerGuideModal";
import { useIsCompact } from "../../hooks/useViewport";

export function SchedulerToolbar() {
  const viewMode = useSchedulerViewStore((s) => s.viewMode);
  const entityMode = useSchedulerViewStore((s) => s.entityMode);
  const zoomLevel = useSchedulerViewStore((s) => s.zoomLevel);
  const columnWidthScale = useSchedulerViewStore((s) => s.columnWidthScale);
  const selectedMemberId = useSchedulerViewStore((s) => s.selectedMemberId);
  const setZoomLevel = useSchedulerViewStore((s) => s.setZoomLevel);
  const setColumnWidthScale = useSchedulerViewStore((s) => s.setColumnWidthScale);
  const [guideOpen, setGuideOpen] = useState(false);
  const showUnifiedOnlyFilters = selectedMemberId === null;
  const isTaskMode = entityMode === "task";
  // 컴팩트(모바일·태블릿): 줌·열너비·도움말 숨김 + 여백 축소로 필터 라인 한 줄 유지
  const isCompact = useIsCompact();

  // 오늘로 이동 — ScheduleGrid 에서 이벤트를 listen
  const scrollToToday = () => {
    window.dispatchEvent(new CustomEvent("lc-scheduler:scroll-today"));
  };

  // 열너비 초기화
  const resetColumnWidthScale = () => {
    setColumnWidthScale(1);
  };

  return (
    <div
      className={`bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between flex-shrink-0 ${
        isCompact ? "px-3 py-1.5" : "px-6 py-3"
      }`}
    >
      {/* 좌측: 필터 그룹 */}
      <div className={`flex items-center ${isCompact ? "gap-1.5 flex-nowrap min-w-0" : "gap-4 flex-wrap"}`}>
        {!isTaskMode ? (
          <>
            <YearSelector />
            <MonthFilter />
            {entityMode === "feature" && <FeatureMilestoneFilter />}
          </>
        ) : viewMode === "year" ? (
          <>
            <YearSelector />
            <MonthFilter />
            <div
              className={showUnifiedOnlyFilters ? "" : "invisible pointer-events-none"}
              aria-hidden={!showUnifiedOnlyFilters}
            >
              <JobTitleFilter />
            </div>
            <div
              className={showUnifiedOnlyFilters ? "" : "invisible pointer-events-none"}
              aria-hidden={!showUnifiedOnlyFilters}
            >
              <WeekViewMemberFilter />
            </div>
          </>
        ) : (
          <>
            <JobTitleFilter />
            <WeekViewMemberFilter />
          </>
        )}
      </div>

      {/* 우측: 컨트롤 그룹 */}
      <div className={`flex items-center justify-end shrink-0 ${isCompact ? "gap-1" : "gap-2 flex-wrap"}`}>
        {/* 오늘 버튼 */}
        {(viewMode === "year" || viewMode === "month" || viewMode === "week") && (
          <button
            onClick={scrollToToday}
            className={`flex items-center bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-md transition-colors font-medium text-zinc-900 dark:text-zinc-100 ${
              isCompact ? "gap-1 px-2 py-1 text-xs" : "gap-1.5 px-3 py-1.5 text-sm"
            }`}
            title="오늘 날짜로 이동"
          >
            <CalendarDays className="w-4 h-4" />
            오늘
          </button>
        )}

        {/* 열너비 컨트롤 (연간 전용, 컴팩트에선 숨김) */}
        {!isCompact && viewMode === "year" && (
          <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 rounded-md p-1">
            <Columns3 className="w-4 h-4 text-zinc-500 dark:text-zinc-400 ml-1" />
            <button
              onClick={() =>
                setColumnWidthScale(Math.max(0.5, columnWidthScale - 0.25))
              }
              className="p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded transition-colors disabled:opacity-50"
              title="열너비 축소"
              disabled={columnWidthScale <= 0.5}
            >
              <Minus className="w-3 h-3" />
            </button>
            <span
              className="text-xs font-medium w-10 text-center"
              title="열너비 배율"
            >
              {Math.round(columnWidthScale * 100)}%
            </span>
            <button
              onClick={() =>
                setColumnWidthScale(Math.min(4.0, columnWidthScale + 0.25))
              }
              className="p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded transition-colors disabled:opacity-50"
              title="열너비 확대"
              disabled={columnWidthScale >= 4.0}
            >
              <Plus className="w-3 h-3" />
            </button>
            <button
              onClick={resetColumnWidthScale}
              className="p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded transition-colors disabled:opacity-50"
              title="열너비 초기화 (100%)"
              disabled={columnWidthScale === 1.0}
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* 줌 컨트롤 (컴팩트에선 숨김) */}
        {!isCompact && (viewMode === "year" || viewMode === "month" || viewMode === "week") && (
          <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 rounded-md p-1">
            <button
              onClick={() => setZoomLevel(Math.max(0.5, zoomLevel - 0.25))}
              className="p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded transition-colors disabled:opacity-50"
              title="축소"
              disabled={zoomLevel <= 0.5}
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-xs font-medium w-12 text-center">
              {Math.round(zoomLevel * 100)}%
            </span>
            <button
              onClick={() => setZoomLevel(Math.min(2.0, zoomLevel + 0.25))}
              className="p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded transition-colors disabled:opacity-50"
              title="확대"
              disabled={zoomLevel >= 2.0}
            >
              <ZoomIn className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* 사용가이드 모달 (컴팩트에선 숨김) */}
        {!isCompact && (
        <button
          type="button"
          onClick={() => setGuideOpen(true)}
          className="flex h-8 w-8 items-center justify-center rounded-md bg-zinc-100 text-zinc-900 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
          title="사용 가이드"
          aria-label="사용 가이드 열기"
        >
          <HelpCircle className="h-4 w-4" />
        </button>
        )}
      </div>

      {guideOpen && <SchedulerGuideModal onClose={() => setGuideOpen(false)} />}
    </div>
  );
}
