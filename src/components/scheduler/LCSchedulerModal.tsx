// LC 스케줄러 풀스크린 모달 — createPortal, 뷰 모드 라우팅.
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useSchedulerStore } from "../../store/schedulerStore";
import { useSchedulerViewStore } from "../../store/schedulerViewStore";
import { useSchedulerProjectsStore } from "../../store/schedulerProjectsStore";
import { useSchedulerHolidaysStore } from "../../store/schedulerHolidaysStore";
import { useOrganizationStore } from "../../store/organizationStore";
import { useTeamStore } from "../../store/teamStore";
import { useSchedulerFiltersStore } from "../../store/schedulerFiltersStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { usePageStore } from "../../store/pageStore";
import type { SelectOption } from "../../types/database";
import {
  startOfYear,
  toIsoStartOfDay,
  toIsoEndOfDay,
} from "../../lib/scheduler/dateUtils";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../lib/scheduler/scope";
import { LC_SCHEDULER_COLUMN_IDS, makeLCSchedulerDatabaseId } from "../../lib/scheduler/database";
import { SchedulerHeader } from "./SchedulerHeader";
import { SchedulerTeamTabs } from "./SchedulerTeamTabs";
import { SchedulerToolbar } from "./SchedulerToolbar";
import { ScheduleGrid } from "./ScheduleGrid";
import { WeekScheduleView } from "./WeekScheduleView";
import { WeeklyMmPanel } from "./mm/WeeklyMmPanel";

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
  const projects = useSchedulerProjectsStore((s) => s.projects);
  const organizations = useOrganizationStore((s) => s.organizations);
  const teams = useTeamStore((s) => s.teams);
  const disabledOrgIds = useSchedulerFiltersStore((s) => s.disabledOrgIds);
  const disabledTeamIds = useSchedulerFiltersStore((s) => s.disabledTeamIds);
  const viewMode = useSchedulerViewStore((s) => s.viewMode);
  const currentYear = useSchedulerViewStore((s) => s.currentYear);
  const schedulerWorkspaceId = LC_SCHEDULER_WORKSPACE_ID;
  const schedulerDatabaseId = makeLCSchedulerDatabaseId(schedulerWorkspaceId);
  const schedulerDbUpdatedAt = useDatabaseStore(
    (s) => s.databases[schedulerDatabaseId]?.meta.updatedAt ?? 0,
  );
  const schedulerRowsUpdatedAt = usePageStore((s) =>
    Object.values(s.pages)
      .filter((page) => page.databaseId === schedulerDatabaseId)
      .map((page) => `${page.id}:${page.updatedAt}`)
      .join("|"),
  );
  const updateColumn = useDatabaseStore((s) => s.updateColumn);
  const schedulerColumns = useDatabaseStore((s) => s.databases[schedulerDatabaseId]?.columns ?? []);

  // 마운트 시 + 연도 변경 시 해당 연도 일정 페치
  useEffect(() => {
    const from = toIsoStartOfDay(startOfYear(currentYear));
    const to = toIsoEndOfDay(endOfYear(currentYear));
    void fetchSchedules(schedulerWorkspaceId, from, to);
  }, [
    currentYear,
    fetchSchedules,
    schedulerWorkspaceId,
    schedulerDbUpdatedAt,
    schedulerRowsUpdatedAt,
  ]);

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

  // 프로젝트/조직/팀 옵션은 스케줄러 설정의 활성 목록과 자동 동기화한다.
  useEffect(() => {
    const projectColumn = schedulerColumns.find((col) => col.id === LC_SCHEDULER_COLUMN_IDS.project);
    const orgColumn = schedulerColumns.find((col) => col.id === LC_SCHEDULER_COLUMN_IDS.organization);
    const teamColumn = schedulerColumns.find((col) => col.id === LC_SCHEDULER_COLUMN_IDS.team);
    if (!projectColumn || !orgColumn || !teamColumn) return;

    const activeProjectOptions: SelectOption[] = projects
      .filter((project) => !project.isHidden)
      .map((project) => ({ id: project.id, label: project.name, color: project.color }));
    const activeOrgOptions: SelectOption[] = organizations
      .filter((org) => !org.removedAt && !disabledOrgIds.includes(org.organizationId))
      .map((org) => ({ id: org.organizationId, label: org.name }));
    const activeTeamOptions: SelectOption[] = teams
      .filter((team) => !team.removedAt && !disabledTeamIds.includes(team.teamId))
      .map((team) => ({ id: team.teamId, label: team.name }));

    const syncOptions = (columnId: string, current: SelectOption[] | undefined, next: SelectOption[]) => {
      if (JSON.stringify(current ?? []) === JSON.stringify(next)) return;
      updateColumn(schedulerDatabaseId, columnId, {
        config: { options: next },
      });
    };

    syncOptions(projectColumn.id, projectColumn.config?.options, activeProjectOptions);
    syncOptions(orgColumn.id, orgColumn.config?.options, activeOrgOptions);
    syncOptions(teamColumn.id, teamColumn.config?.options, activeTeamOptions);
  }, [
    disabledOrgIds,
    disabledTeamIds,
    organizations,
    projects,
    schedulerColumns,
    schedulerDatabaseId,
    teams,
    updateColumn,
  ]);

  return createPortal(
    <div
      data-lc-scheduler-modal="true"
      className="fixed inset-0 z-[500] bg-zinc-50 dark:bg-zinc-950 flex flex-col"
    >
      {/* 헤더 */}
      <SchedulerHeader onClose={onClose} />

      {/* 팀 탭 */}
      <SchedulerTeamTabs />

      {/* 툴바: 연도·월·직군·이름 필터 + 오늘·열너비·줌·도움말 */}
      <SchedulerToolbar />

      {/* 본문: 연간 뷰 or 주간 뷰 */}
      {viewMode === "year" ? (
        <ScheduleGrid workspaceId={schedulerWorkspaceId} />
      ) : (
        <WeekScheduleView />
      )}

      <WeeklyMmPanel />
    </div>,
    document.body,
  );
}
