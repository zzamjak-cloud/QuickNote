import { beforeEach, describe, expect, it } from "vitest";
import { useTeamStore, type Team } from "../teamStore";
import type { Member } from "../memberStore";

function member(id: string, name: string): Member {
  return {
    memberId: id,
    email: `${id}@x.com`,
    name,
    jobRole: "Engineer",
    workspaceRole: "member",
    status: "active",
    personalWorkspaceId: `ws-${id}`,
  };
}

function team(id: string, name: string, members: Member[] = []): Team {
  return { teamId: id, name, members };
}

describe("teamStore", () => {
  beforeEach(() => {
    useTeamStore.getState().clear();
  });

  it("팀 목록 캐시를 설정한다", () => {
    useTeamStore.getState().setTeams([team("t1", "Design"), team("t2", "Backend")]);
    expect(useTeamStore.getState().teams).toHaveLength(2);
  });

  it("upsertTeam은 기존 팀을 수정하고 없으면 추가한다", () => {
    useTeamStore.getState().setTeams([team("t1", "Design")]);
    useTeamStore.getState().upsertTeam(team("t1", "Design System"));
    expect(useTeamStore.getState().teams[0]?.name).toBe("Design System");

    useTeamStore.getState().upsertTeam(team("t2", "Backend"));
    expect(useTeamStore.getState().teams).toHaveLength(2);
  });

  it("팀 멤버 lookup이 동작한다", () => {
    useTeamStore.getState().setTeams([
      team("t1", "QA", [member("m1", "Kim"), member("m2", "Park")]),
    ]);
    const members = useTeamStore.getState().getTeamMembers("t1");
    expect(members.map((m) => m.memberId)).toEqual(["m1", "m2"]);
  });

  it("removeTeam은 팀을 제거한다", () => {
    useTeamStore.getState().setTeams([team("t1", "QA"), team("t2", "Dev")]);
    useTeamStore.getState().removeTeam("t1");
    expect(useTeamStore.getState().teams.map((t) => t.teamId)).toEqual(["t2"]);
  });
});
