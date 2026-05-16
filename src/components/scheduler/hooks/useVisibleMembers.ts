// 헤더의 조직/팀/프로젝트 선택값에 따라 표시할 멤버 목록을 계산하는 훅.
import { useMemo } from "react";
import { useMemberStore, type Member } from "../../../store/memberStore";
import { useOrganizationStore } from "../../../store/organizationStore";
import { useTeamStore } from "../../../store/teamStore";
import { useSchedulerViewStore } from "../../../store/schedulerViewStore";
import { useSchedulerProjectsStore } from "../../../store/schedulerProjectsStore";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../../lib/scheduler/scope";

// selectedProjectId 포맷: "org:{id}", "team:{id}", "proj:{id}" 또는 null
export function useVisibleMembers(): Member[] {
  const allMembers = useMemberStore((s) => s.members);
  const memberCacheWorkspaceId = useMemberStore((s) => s.cacheWorkspaceId);
  const organizations = useOrganizationStore((s) => s.organizations);
  const organizationCacheWorkspaceId = useOrganizationStore((s) => s.cacheWorkspaceId);
  const teams = useTeamStore((s) => s.teams);
  const teamCacheWorkspaceId = useTeamStore((s) => s.cacheWorkspaceId);
  const projects = useSchedulerProjectsStore((s) => s.projects);
  const selectedProjectId = useSchedulerViewStore((s) => s.selectedProjectId);

  return useMemo(() => {
    if (memberCacheWorkspaceId && memberCacheWorkspaceId !== LC_SCHEDULER_WORKSPACE_ID) {
      return [];
    }
    // 활성 멤버만(재직중 우선 표시는 별도 정렬에서 처리)
    const active = allMembers.filter((m) => m.status === "active");

    if (!selectedProjectId) return sortMembers(active);

    if (selectedProjectId.startsWith("org:")) {
      if (organizationCacheWorkspaceId && organizationCacheWorkspaceId !== LC_SCHEDULER_WORKSPACE_ID) {
        return sortMembers(active);
      }
      const orgId = selectedProjectId.slice(4);
      const org = organizations.find((o) => o.organizationId === orgId);
      if (!org) return sortMembers(active);
      const ids = new Set(org.members.map((m) => m.memberId));
      return sortMembers(active.filter((m) => ids.has(m.memberId)));
    }

    if (selectedProjectId.startsWith("team:")) {
      if (teamCacheWorkspaceId && teamCacheWorkspaceId !== LC_SCHEDULER_WORKSPACE_ID) {
        return sortMembers(active);
      }
      const teamId = selectedProjectId.slice(5);
      const team = teams.find((t) => t.teamId === teamId);
      if (!team) return sortMembers(active);
      const ids = new Set(team.members.map((m) => m.memberId));
      return sortMembers(active.filter((m) => ids.has(m.memberId)));
    }

    // 프로젝트 선택: memberIds 기준 필터
    if (selectedProjectId.startsWith("proj:")) {
      const projId = selectedProjectId.slice(5);
      const project = projects.find((p) => p.id === projId);
      if (!project) return sortMembers(active);
      const ids = new Set(project.memberIds);
      return sortMembers(active.filter((m) => ids.has(m.memberId)));
    }

    return sortMembers(active);
  }, [
    allMembers,
    memberCacheWorkspaceId,
    organizationCacheWorkspaceId,
    organizations,
    projects,
    selectedProjectId,
    teamCacheWorkspaceId,
    teams,
  ]);
}

// 재직중 우선 → name 오름차순
function sortMembers(list: Member[]): Member[] {
  return [...list].sort((a, b) => {
    const aActive = (a.employmentStatus ?? "재직중") === "재직중" ? 0 : 1;
    const bActive = (b.employmentStatus ?? "재직중") === "재직중" ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return a.name.localeCompare(b.name, "ko");
  });
}
