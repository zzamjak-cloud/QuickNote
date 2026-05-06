import { describe, expect, it, vi } from "vitest";
import {
  createTeam,
  deleteTeam,
  getTeam,
  listTeams,
  updateTeam,
} from "./team";
import type { Member, Tables } from "./member";

const tables: Tables = {
  Members: "M",
  Teams: "T",
  MemberTeams: "MT",
  Workspaces: "W",
  WorkspaceAccess: "WA",
};

const owner: Member = {
  memberId: "owner",
  email: "owner@x.com",
  name: "Owner",
  jobRole: "Lead",
  workspaceRole: "owner",
  status: "active",
  personalWorkspaceId: "ws-owner",
  cognitoSub: "sub-owner",
  createdAt: "2026-01-01T00:00:00Z",
};
const memberCaller: Member = { ...owner, memberId: "m1", workspaceRole: "member" };

function mockDoc(...returns: unknown[]) {
  const send = vi.fn();
  returns.forEach((r) => send.mockResolvedValueOnce(r));
  return { send } as unknown as import("@aws-sdk/lib-dynamodb").DynamoDBDocumentClient;
}

describe("team handlers", () => {
  it("createTeam: member 권한 거부", async () => {
    const doc = mockDoc();
    await expect(createTeam({ doc, tables, caller: memberCaller, name: "Dev" })).rejects.toThrow();
  });

  it("createTeam: 정상 생성", async () => {
    const doc = mockDoc({});
    const t = await createTeam({ doc, tables, caller: owner, name: "Dev" });
    expect(t.name).toBe("Dev");
    expect(t.members).toEqual([]);
  });

  it("getTeam: 없으면 null", async () => {
    const doc = mockDoc({});
    const result = await getTeam({ doc, tables, caller: owner, teamId: "nope" });
    expect(result).toBeNull();
  });

  it("listTeams: Scan 후 멤버 해석", async () => {
    const doc = mockDoc(
      { Items: [{ teamId: "t1", name: "Team 1", createdAt: "now" }] },
      { Items: [] },
    );
    const result = await listTeams({ doc, tables, caller: owner });
    expect(result).toHaveLength(1);
    expect(result[0].teamId).toBe("t1");
  });

  it("updateTeam: 존재하지 않으면 에러", async () => {
    const doc = mockDoc({});
    await expect(updateTeam({ doc, tables, caller: owner, teamId: "x", name: "Y" })).rejects.toThrow();
  });

  it("deleteTeam: 없으면 false", async () => {
    const doc = mockDoc({});
    const ok = await deleteTeam({ doc, tables, caller: owner, teamId: "x" });
    expect(ok).toBe(false);
  });
});
