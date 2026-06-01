// 헤더의 조직/팀/프로젝트 선택값에 따라 표시할 멤버 목록을 계산하는 훅.
import { useMemo } from "react";
import { useMemberStore, type Member } from "../../../store/memberStore";
import { useOrganizationStore } from "../../../store/organizationStore";
import { useTeamStore } from "../../../store/teamStore";
import { useSchedulerViewStore } from "../../../store/schedulerViewStore";
import { useSchedulerProjectsStore } from "../../../store/schedulerProjectsStore";
import { useDatabaseStore } from "../../../store/databaseStore";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../../lib/scheduler/scope";
import { LC_SCHEDULER_DATABASE_ID } from "../../../lib/scheduler/database";

// selectedProjectId 포맷: "org:{id}", "team:{id}", "proj:{id}" 또는 null
// ignoreJobFilter: 직무 필터 자체의 옵션 목록처럼 직무 필터를 적용하면 안 되는 호출부용
export function useVisibleMembers(options?: { ignoreJobFilter?: boolean }): Member[] {
  const ignoreJobFilter = options?.ignoreJobFilter ?? false;
  const allMembers = useMemberStore((s) => s.members);
  const memberCacheWorkspaceId = useMemberStore((s) => s.cacheWorkspaceId);
  const organizations = useOrganizationStore((s) => s.organizations);
  const organizationCacheWorkspaceId = useOrganizationStore((s) => s.cacheWorkspaceId);
  const teams = useTeamStore((s) => s.teams);
  const teamCacheWorkspaceId = useTeamStore((s) => s.cacheWorkspaceId);
  const projects = useSchedulerProjectsStore((s) => s.projects);
  const selectedProjectId = useSchedulerViewStore((s) => s.selectedProjectId);
  const selectedJobTitle = useSchedulerViewStore((s) => s.selectedJobTitle);
  // 구성원 표시 순서는 작업 DB panelState 에 저장돼 워크스페이스 전 사용자에게 공유 동기화된다.
  const schedulerMemberOrder = useDatabaseStore(
    (s) => s.databases[LC_SCHEDULER_DATABASE_ID]?.panelState?.schedulerMemberOrder,
  );
  const jobFilter = ignoreJobFilter ? null : selectedJobTitle;

  return useMemo(() => {
    if (memberCacheWorkspaceId && memberCacheWorkspaceId !== LC_SCHEDULER_WORKSPACE_ID) {
      return [];
    }
    // 활성 멤버만(재직중 우선 표시는 별도 정렬에서 처리) + 직무(jobCategory) 필터
    const active = allMembers
      .filter((m) => m.status === "active")
      .filter((m) => !jobFilter || m.jobCategory === jobFilter);

    if (!selectedProjectId) return sortMembersBySchedulerOrder(active, schedulerMemberOrder);

    if (selectedProjectId.startsWith("org:")) {
      if (organizationCacheWorkspaceId && organizationCacheWorkspaceId !== LC_SCHEDULER_WORKSPACE_ID) {
        return sortMembersBySchedulerOrder(active, schedulerMemberOrder);
      }
      const orgId = selectedProjectId.slice(4);
      const org = organizations.find((o) => o.organizationId === orgId);
      if (!org) return sortMembersBySchedulerOrder(active, schedulerMemberOrder);
      const ids = new Set(org.members.map((m) => m.memberId));
      return sortMembersBySchedulerOrder(
        active.filter((m) => ids.has(m.memberId)),
        schedulerMemberOrder,
      );
    }

    if (selectedProjectId.startsWith("team:")) {
      if (teamCacheWorkspaceId && teamCacheWorkspaceId !== LC_SCHEDULER_WORKSPACE_ID) {
        return sortMembersBySchedulerOrder(active, schedulerMemberOrder);
      }
      const teamId = selectedProjectId.slice(5);
      const team = teams.find((t) => t.teamId === teamId);
      if (!team) return sortMembersBySchedulerOrder(active, schedulerMemberOrder);
      const ids = new Set(team.members.map((m) => m.memberId));
      return sortMembersBySchedulerOrder(
        active.filter((m) => ids.has(m.memberId)),
        schedulerMemberOrder,
      );
    }

    // 프로젝트 선택: memberIds 기준 필터
    if (selectedProjectId.startsWith("proj:")) {
      const projId = selectedProjectId.slice(5);
      const project = projects.find((p) => p.id === projId);
      if (!project) return sortMembersBySchedulerOrder(active, schedulerMemberOrder);
      const ids = new Set(project.memberIds);
      return sortMembersBySchedulerOrder(
        active.filter((m) => ids.has(m.memberId)),
        schedulerMemberOrder,
      );
    }

    return sortMembersBySchedulerOrder(active, schedulerMemberOrder);
  }, [
    allMembers,
    memberCacheWorkspaceId,
    organizationCacheWorkspaceId,
    organizations,
    projects,
    schedulerMemberOrder,
    selectedProjectId,
    jobFilter,
    teamCacheWorkspaceId,
    teams,
  ]);
}

// 재직중 우선 → name 오름차순
export function sortMembersBySchedulerOrder(
  list: Member[],
  schedulerMemberOrder: readonly string[] = [],
): Member[] {
  const base = [...list].sort((a, b) => {
    const aActive = (a.employmentStatus ?? "재직중") === "재직중" ? 0 : 1;
    const bActive = (b.employmentStatus ?? "재직중") === "재직중" ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return a.name.localeCompare(b.name, "ko");
  });
  if (schedulerMemberOrder.length === 0) return base;

  const order = new Map(schedulerMemberOrder.map((memberId, index) => [memberId, index]));
  return base.sort((a, b) => {
    const aOrder = order.get(a.memberId);
    const bOrder = order.get(b.memberId);
    if (aOrder != null && bOrder != null) return aOrder - bOrder;
    if (aOrder != null) return -1;
    if (bOrder != null) return 1;
    return 0;
  });
}
