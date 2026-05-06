import { describe, expect, it, vi } from "vitest";
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  listMyWorkspaces,
  setWorkspaceAccess,
  updateWorkspace,
} from "./workspace";
import type { Member, Tables } from "./member";

const tables: Tables = {
  Members: "M",
  Teams: "T",
  MemberTeams: "MT",
  Workspaces: "W",
  WorkspaceAccess: "WA",
  Pages: "P",
  Databases: "D",
};

const caller: Member = {
  memberId: "owner",
  email: "owner@x.com",
  name: "Owner",
  jobRole: "Lead",
  workspaceRole: "owner",
  status: "active",
  personalWorkspaceId: "ws-personal",
  cognitoSub: "sub-owner",
  createdAt: "2026-01-01T00:00:00Z",
};

function mockDoc(...returns: unknown[]) {
  const send = vi.fn();
  returns.forEach((r) => send.mockResolvedValueOnce(r));
  return { send } as unknown as import("@aws-sdk/lib-dynamodb").DynamoDBDocumentClient;
}

describe("workspace handlers", () => {
  it("createWorkspace: 기본 생성", async () => {
    const doc = mockDoc({}, {});
    const ws = await createWorkspace({
      doc,
      tables,
      caller,
      input: {
        name: "Shared",
        access: [{ subjectType: "EVERYONE", level: "VIEW" }],
      },
    });
    expect(ws.name).toBe("Shared");
    expect(ws.myEffectiveLevel).toBe("edit");
  });

  it("updateWorkspace: 없으면 실패", async () => {
    const doc = mockDoc({});
    await expect(
      updateWorkspace({ doc, tables, caller, input: { workspaceId: "x", name: "N" } }),
    ).rejects.toThrow();
  });

  it("setWorkspaceAccess: 기존 삭제 후 삽입", async () => {
    const doc = mockDoc(
      { Item: { workspaceId: "w1", name: "N", type: "shared", ownerMemberId: caller.memberId, createdAt: "now" } },
      { Items: [{ workspaceId: "w1", subjectKey: "everyone#*" }] },
      {},
    );
    const ws = await setWorkspaceAccess({
      doc,
      tables,
      caller,
      workspaceId: "w1",
      entries: [{ subjectType: "TEAM", subjectId: "t1", level: "EDIT" }],
    });
    expect(ws.access).toHaveLength(1);
    expect(doc.send).toHaveBeenCalledTimes(4);
  });

  it("listMyWorkspaces: personal 포함", async () => {
    const doc = mockDoc(
      { Items: [] },
      { Items: [] },
      { Items: [] },
      { Item: { workspaceId: caller.personalWorkspaceId, name: "P", type: "personal", ownerMemberId: caller.memberId, createdAt: "now" } },
      { Items: [{ workspaceId: caller.personalWorkspaceId, subjectType: "member", subjectId: caller.memberId, level: "edit" }] },
    );
    const list = await listMyWorkspaces({ doc, tables, caller });
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it("getWorkspace: 접근 없으면 null", async () => {
    const doc = mockDoc(
      { Item: { workspaceId: "w1", name: "W", type: "shared", ownerMemberId: "o", createdAt: "now" } },
      { Items: [] },
      { Items: [] },
    );
    const ws = await getWorkspace({ doc, tables, caller, workspaceId: "w1" });
    expect(ws).toBeNull();
  });

  it("deleteWorkspace: 없으면 false", async () => {
    const doc = mockDoc({});
    const ok = await deleteWorkspace({ doc, tables, caller, workspaceId: "nope" });
    expect(ok).toBe(false);
  });
});
