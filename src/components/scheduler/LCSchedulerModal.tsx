// LC 스케줄러 풀스크린 모달 — createPortal, ESC 닫기, 뷰 모드 라우팅.
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useSchedulerStore } from "../../store/schedulerStore";
import { useSchedulerViewStore } from "../../store/schedulerViewStore";
import { useSchedulerProjectsStore } from "../../store/schedulerProjectsStore";
import { useSchedulerHolidaysStore } from "../../store/schedulerHolidaysStore";
import {
  startOfYear,
  toIsoStartOfDay,
  toIsoEndOfDay,
} from "../../lib/scheduler/dateUtils";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../lib/scheduler/scope";
import { SchedulerHeader } from "./SchedulerHeader";
import { SchedulerTeamTabs } from "./SchedulerTeamTabs";
import { SchedulerToolbar } from "./SchedulerToolbar";
import { ScheduleGrid } from "./ScheduleGrid";
import { WeekScheduleView } from "./WeekScheduleView";

// 연도의 마지막 날짜
function endOfYear(year: number): Date {
  return new Date(year, 11, 31, 23, 59, 59, 999);
}

type Props = {
  onClose: () => void;
};

export function LCSchedulerModal({ onClose }: Props) {
  const fetchSchedules = useSchedulerStore((s) => s.fetchSchedules);
  const fetchProjects = useSchedulerProjectsStore((s) => s.fetchProjects);
  const fetchHolidays = useSchedulerHolidaysStore((s) => s.fetchHolidays);
  const viewMode = useSchedulerViewStore((s) => s.viewMode);
  const currentYear = useSchedulerViewStore((s) => s.currentYear);

  // 마운트 시 + 연도 변경 시 해당 연도 일정 페치
  useEffect(() => {
    const from = toIsoStartOfDay(startOfYear(currentYear));
    const to = toIsoEndOfDay(endOfYear(currentYear));
    void fetchSchedules(LC_SCHEDULER_WORKSPACE_ID, from, to);
  }, [currentYear, fetchSchedules]);

  // 프로젝트·공휴일은 첫 페인트 이후 갱신한다.
  useEffect(() => {
    const loadSecondaryData = () => {
      void fetchProjects(LC_SCHEDULER_WORKSPACE_ID);
      void fetchHolidays(LC_SCHEDULER_WORKSPACE_ID);
    };
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(loadSecondaryData, { timeout: 1500 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(loadSecondaryData, 0);
    return () => clearTimeout(id);
  }, [fetchProjects, fetchHolidays]);

  // ESC 키 닫기
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[500] bg-zinc-50 dark:bg-zinc-950 flex flex-col">
      {/* 헤더 */}
      <SchedulerHeader onClose={onClose} />

      {/* 팀 탭 */}
      <SchedulerTeamTabs />

      {/* 툴바: 연도·월·직군·이름 필터 + 오늘·열너비·줌·도움말 */}
      <SchedulerToolbar />

      {/* 본문: 연간 뷰 or 주간 뷰 */}
      {viewMode === "year" ? (
        <ScheduleGrid workspaceId={LC_SCHEDULER_WORKSPACE_ID} />
      ) : (
        <WeekScheduleView />
      )}
    </div>,
    document.body,
  );
}
