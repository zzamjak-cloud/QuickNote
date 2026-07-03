// LC 스케줄러 풀스크린 모달 — createPortal, 뷰 모드 라우팅.
import { lazy, Suspense, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSchedulerStore } from "../../store/schedulerStore";
import { useSchedulerViewStore } from "../../store/schedulerViewStore";
import { useSchedulerProjectsStore } from "../../store/schedulerProjectsStore";
import { useSchedulerHolidaysStore } from "../../store/schedulerHolidaysStore";
import { useOrganizationStore } from "../../store/organizationStore";
import { useTeamStore } from "../../store/teamStore";
import { useMemberStore } from "../../store/memberStore";
import { useSchedulerFiltersStore } from "../../store/schedulerFiltersStore";
import { useDatabaseStore } from "../../store/databaseStore";
import type { SelectOption } from "../../types/database";
import { getSchedulerFetchWindow } from "../../lib/scheduler/rangeWindow";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../lib/scheduler/scope";
import { LC_SCHEDULER_COLUMN_IDS, makeLCSchedulerDatabaseId } from "../../lib/scheduler/database";
import { makeLCMilestoneDatabaseId } from "../../lib/scheduler/milestoneDatabase";
import { makeLCFeatureDatabaseId } from "../../lib/scheduler/featureDatabase";
import { SchedulerHeader } from "./SchedulerHeader";
import { SchedulerTeamTabs } from "./SchedulerTeamTabs";
import { SchedulerToolbar } from "./SchedulerToolbar";
import { WeeklyMmPanel } from "./mm/WeeklyMmPanel";
import { refreshWorkspaceMeta } from "../../lib/sync/workspaceMetaCache";
import { ensureDatabaseRowsLoaded } from "../../lib/sync/externalProtectedDatabaseLoad";

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

type Props = {
  onClose: () => void;
};

export function LCSchedulerModal({ onClose }: Props) {
  const fetchSchedules = useSchedulerStore((s) => s.fetchSchedules);
  const fetchHolidays = useSchedulerHolidaysStore((s) => s.fetchHolidays);
  const projects = useSchedulerProjectsStore((s) => s.projects);
  const organizations = useOrganizationStore((s) => s.organizations);
  const teams = useTeamStore((s) => s.teams);
  const memberRangeSignature = useMemberStore((s) => (
    `${s.cacheWorkspaceId ?? ""}:${s.members
      .map((member) => `${member.memberId}:${member.status}:${member.jobCategory ?? ""}`)
      .join("|")}`
  ));
  const disabledOrgIds = useSchedulerFiltersStore((s) => s.disabledOrgIds);
  const disabledTeamIds = useSchedulerFiltersStore((s) => s.disabledTeamIds);
  const viewMode = useSchedulerViewStore((s) => s.viewMode);
  const entityMode = useSchedulerViewStore((s) => s.entityMode);
  const currentYear = useSchedulerViewStore((s) => s.currentYear);
  const selectMember = useSchedulerViewStore((s) => s.selectMember);
  const setMultiSelected = useSchedulerViewStore((s) => s.setMultiSelected);
  const schedulerWorkspaceId = LC_SCHEDULER_WORKSPACE_ID;
  const schedulerDatabaseId = makeLCSchedulerDatabaseId(schedulerWorkspaceId);
  const milestoneDatabaseId = makeLCMilestoneDatabaseId(schedulerWorkspaceId);
  const featureDatabaseId = makeLCFeatureDatabaseId(schedulerWorkspaceId);
  const schedulerDbUpdatedAt = useDatabaseStore(
    (s) => s.databases[schedulerDatabaseId]?.meta.updatedAt ?? 0,
  );
  const updateColumn = useDatabaseStore((s) => s.updateColumn);
  const schedulerColumns = useDatabaseStore((s) => s.databases[schedulerDatabaseId]?.columns ?? []);
  const selectedProjectId = useSchedulerViewStore((s) => s.selectedProjectId);
  const selectedMemberId = useSchedulerViewStore((s) => s.selectedMemberId);
  const selectedJobTitle = useSchedulerViewStore((s) => s.selectedJobTitle);
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

  useEffect(() => {
    let cancelled = false;
    const databaseIds = [schedulerDatabaseId, milestoneDatabaseId, featureDatabaseId];
    void Promise.all(
      databaseIds.map((databaseId) =>
        ensureDatabaseRowsLoaded({
          databaseId,
          currentWorkspaceId: schedulerWorkspaceId,
          cancelled: () => cancelled,
          source: "lc-scheduler-modal",
          // 피처는 scope(org/team/project)가 연결 마일스톤에서 미러될 뿐 자신의 dbCells 에는
          // 없어 서버 scoped 쿼리로는 누락된다. 전체(unscoped) 로드 후 클라가
          // getScopedMilestoneIds/matchesSchedulerScope 로 마일스톤 scope 기준 필터한다.
          // (피처는 마일스톤과 같은 구조적 데이터라 규모가 유계 — 전체 로드 가능)
          loadContext: databaseId === featureDatabaseId ? "inline" : "scheduler",
        }),
      ),
    ).catch((error) => {
      console.warn("[LCSchedulerModal] 보호 DB row 로드 실패", error);
    });
    return () => {
      cancelled = true;
    };
  }, [
    featureDatabaseId,
    milestoneDatabaseId,
    schedulerDatabaseId,
    schedulerWorkspaceId,
    selectedMemberId,
    selectedProjectId,
  ]);

  // 마운트 시 + 연도 변경 시 사용자가 보는 주변 월만 먼저 가져온다.
  useEffect(() => {
    const { from, to } = getSchedulerFetchWindow({ currentYear });
    void fetchSchedules(schedulerWorkspaceId, from, to);
  }, [
    currentYear,
    fetchSchedules,
    memberRangeSignature,
    organizations,
    projects,
    schedulerWorkspaceId,
    schedulerDbUpdatedAt,
    selectedJobTitle,
    selectedMemberId,
    selectedProjectId,
    teams,
  ]);

  // 공휴일은 첫 페인트 이후 갱신한다. 프로젝트는 workspace meta 통합 API가 함께 가져온다.
  useEffect(() => {
    const loadSecondaryData = () => {
      void fetchHolidays(LC_SCHEDULER_WORKSPACE_ID);
    };
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(loadSecondaryData, { timeout: 1500 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(loadSecondaryData, 0);
    return () => clearTimeout(id);
  }, [fetchHolidays]);

  // 모달 진입 및 화면 복귀 시에만 프로젝트/조직/팀 메타를 재조회한다.
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    const refreshSchedulerMeta = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        await refreshWorkspaceMeta(LC_SCHEDULER_WORKSPACE_ID);
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

    void refreshSchedulerMeta();
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

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
