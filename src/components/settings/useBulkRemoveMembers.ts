import { useCallback, useState } from "react";
import { removeMemberApi, unassignMemberFromTeamApi } from "../../lib/sync/memberApi";
import { unassignMemberFromOrganizationApi } from "../../lib/sync/organizationApi";
import type { Member } from "../../store/memberStore";
import { useOrganizationStore } from "../../store/organizationStore";
import { useTeamStore } from "../../store/teamStore";

export type BulkRemoveResult = {
  removed: Member[];
  failed: Member[];
};

/** 오너·본인은 일괄 제거 대상에서 제외한다 (단건 모달과 동일한 보호). */
export function isBulkRemovable(member: Member, meId: string | undefined): boolean {
  return member.workspaceRole !== "owner" && member.memberId !== meId;
}

/**
 * 선택한 구성원들을 보관함으로 일괄 이동한다.
 * 단건 MemberModal.handleRemove 와 동일하게 팀/조직 분리 후 removeMember 를 호출하며,
 * 서버 부하를 피하려고 구성원 단위로 순차 처리하고 실패는 모아서 반환한다.
 */
export function useBulkRemoveMembers() {
  const [running, setRunning] = useState(false);

  const removeMembers = useCallback(async (targets: Member[]): Promise<BulkRemoveResult> => {
    setRunning(true);
    const removed: Member[] = [];
    const failed: Member[] = [];
    try {
      for (const member of targets) {
        try {
          await detachFromGroups(member.memberId);
          const result = await removeMemberApi(member.memberId);
          removed.push({
            ...member,
            ...result,
            workspaceRole: result.workspaceRole ?? member.workspaceRole ?? "member",
            status: result.status ?? "removed",
          });
        } catch (e) {
          console.error("[useBulkRemoveMembers] 구성원 제거 실패", member.memberId, e);
          failed.push(member);
        }
      }
    } finally {
      setRunning(false);
    }
    return { removed, failed };
  }, []);

  return { removeMembers, running };
}

async function detachFromGroups(memberId: string): Promise<void> {
  const teamIds = useTeamStore.getState().teams
    .filter((team) => team.members.some((m) => m.memberId === memberId))
    .map((team) => team.teamId);
  const organizationIds = useOrganizationStore.getState().organizations
    .filter((org) => org.members.some((m) => m.memberId === memberId))
    .map((org) => org.organizationId);
  if (teamIds.length === 0 && organizationIds.length === 0) return;

  const results = await Promise.allSettled([
    ...teamIds.map((teamId) => unassignMemberFromTeamApi(memberId, teamId)),
    ...organizationIds.map((orgId) => unassignMemberFromOrganizationApi(memberId, orgId)),
  ]);
  if (results.some((r) => r.status === "rejected")) {
    console.warn("[useBulkRemoveMembers] 구성원 그룹 분리 일부 실패", { memberId, teamIds, organizationIds });
  }
}
