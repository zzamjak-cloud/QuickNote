// LC 스케줄러 풀스크린 모달 — createPortal, 뷰 모드 라우팅.
import { lazy, Suspense, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSchedulerStore } from "../../store/schedulerStore";
import { useSchedulerViewStore } from "../../store/schedulerViewStore";
import { useSchedulerProjectsStore } from "../../store/schedulerProjectsStore";
import { useSchedulerHolidaysStore } from "../../store/schedulerHolidaysStore";
import { useOrganizationStore } from "../../store/organizationStore";
import { useTeamStore } from "../../store/teamStore";
import { useSchedulerFiltersStore } from "../../store/schedulerFiltersStore";
import { useDatabaseStore } from "../../store/databaseStore";
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
import { WeeklyMmPanel } from "./mm/WeeklyMmPanel";
import { listTeamsApi } from "../../lib/sync/teamApi";
import { listOrganizationsApi } from "../../lib/sync/organizationApi";

const ScheduleGrid = lazy(() =>
  import("./ScheduleGrid").then((m) => ({ default: m.ScheduleGrid })),
);
const WeekScheduleView = lazy(() =>
  import("./WeekScheduleView").then((m) => ({ default: m.WeekScheduleView })),
);
const MonthScheduleView = lazy(() =>
  import("./WeekScheduleView").then((m) => ({ default: m.MonthScheduleView })),
);
const SchedulerDatabaseTimeline = lazy(() =>
  import("./SchedulerDatabaseTimeline").then((m) => ({ default: m.SchedulerDatabaseTimeline })),
);

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
  const setTeams = useTeamStore((s) => s.setTeams);
  const setOrganizations = useOrganizationStore((s) => s.setOrganizations);
  const disabledOrgIds = useSchedulerFiltersStore((s) => s.disabledOrgIds);
  const disabledTeamIds = useSchedulerFiltersStore((s) => s.disabledTeamIds);
  const viewMode = useSchedulerViewStore((s) => s.viewMode);
  const entityMode = useSchedulerViewStore((s) => s.entityMode);
  const currentYear = useSchedulerViewStore((s) => s.currentYear);
  const selectMember = useSchedulerViewStore((s) => s.selectMember);
  const setMultiSelected = useSchedulerViewStore((s) => s.setMultiSelected);
  const schedulerWorkspaceId = LC_SCHEDULER_WORKSPACE_ID;
  const schedulerDatabaseId = makeLCSchedulerDatabaseId(schedulerWorkspaceId);
  const schedulerDbUpdatedAt = useDatabaseStore(
    (s) => s.databases[schedulerDatabaseId]?.meta.updatedAt ?? 0,
  );
  const updateColumn = useDatabaseStore((s) => s.updateColumn);
  const schedulerColumns = useDatabaseStore((s) => s.databases[schedulerDatabaseId]?.columns ?? []);
  const [bodyReady, setBodyReady] = useState(false);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => setBodyReady(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  // 모달 진입 시 구성원 탭 선택 상태는 항상 통합으로 초기화한다.
  useEffect(() => {
    selectMember(null);
    setMultiSelected([]);
  }, [selectMember, setMultiSelected]);

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

  // 모달이 열려있는 동안 프로젝트/조직/팀 메타를 주기적으로 재조회해 다중 클라이언트 변경을 빠르게 반영한다.
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    const refreshSchedulerMeta = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const [teamsList, organizationsList] = await Promise.all([
          listTeamsApi(),
          listOrganizationsApi(),
          fetchProjects(LC_SCHEDULER_WORKSPACE_ID),
        ]);
        if (cancelled) return;
        setTeams(teamsList, LC_SCHEDULER_WORKSPACE_ID);
        setOrganizations(organizationsList, LC_SCHEDULER_WORKSPACE_ID);
      } catch (error) {
        console.error("[LCSchedulerModal] 메타 동기화 실패", error);
      } finally {
        inFlight = false;
      }
    };

    const handleFocus = () => {
      void refreshSchedulerMeta();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      void refreshSchedulerMeta();
    };

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refreshSchedulerMeta();
    }, 2500);

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [fetchProjects, setOrganizations, setTeams]);

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
      {entityMode === "task" && <SchedulerTeamTabs />}

      {/* 툴바: 연도·월·직군·이름 필터 + 오늘·열너비·줌·도움말 */}
      <SchedulerToolbar />

      {/* 본문: 연간 / 월간 / 주간 뷰 */}
      <Suspense fallback={<div className="flex-1 min-h-0 bg-zinc-50 dark:bg-zinc-950" />}>
        {bodyReady ? (
          entityMode !== "task" ? (
            <SchedulerDatabaseTimeline mode={entityMode} workspaceId={schedulerWorkspaceId} />
          ) : viewMode === "year" ? (
            <ScheduleGrid workspaceId={schedulerWorkspaceId} />
          ) : viewMode === "month" ? (
            <MonthScheduleView />
          ) : (
            <WeekScheduleView />
          )
        ) : (
          <div className="flex-1 min-h-0 bg-zinc-50 dark:bg-zinc-950" />
        )}
      </Suspense>

      {bodyReady && entityMode === "task" && <WeeklyMmPanel />}
    </div>,
    document.body,
  );
}
