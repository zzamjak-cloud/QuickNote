import { describe, it, expect, vi } from "vitest";
import { createMember, listMembers, getMember, buildCreateMemberTxItems } from "./member";
import type { Member, Tables } from "./member";

const tables: Tables = {
  Members: "M", Teams: "T", MemberTeams: "MT",
  Workspaces: "W", WorkspaceAccess: "WA",
};

const ownerCaller: Member = {
  memberId: "owner-1",
  email: "owner@x.com",
  name: "Owner",
  jobRole: "Lead",
  workspaceRole: "owner",
  status: "active",
  personalWorkspaceId: "ws-owner",
  cognitoSub: "owner-sub",
  createdAt: "2026-05-06T00:00:00Z",
};
const memberCaller: Member = { ...ownerCaller, memberId: "m-1", workspaceRole: "member" };

function mockDoc(...returns: unknown[]) {
  const send = vi.fn();
  for (const r of returns) send.mockResolvedValueOnce(r);
  return { send } as unknown as import("@aws-sdk/lib-dynamodb").DynamoDBDocumentClient;
}

describe("buildCreateMemberTxItems", () => {
  it("Members + Workspace + WorkspaceAccess + teamIds N개 = 3 + N items", () => {
    const items = buildCreateMemberTxItems({
      input: { email: "a@x.com", name: "A", jobRole: "E", workspaceRole: "MEMBER", teamIds: ["t1","t2"] },
      tables, memberId: "m1", personalWorkspaceId: "w1", now: "now",
    });
    expect(items).toHaveLength(5);
    expect(items.filter((i) => i.Put.TableName === "MT")).toHaveLength(2);
  });
});

describe("createMember", () => {
  it("Member caller 권한 거부", async () => {
    const doc = mockDoc();
    await expect(createMember({
      doc, tables, caller: memberCaller,
      input: { email: "a@x.com", name: "A", jobRole: "E" },
    })).rejects.toThrow(/권한 부족/);
  });
  it("이메일 중복 거부", async () => {
    const doc = mockDoc({ Items: [{ memberId: "exists" }] });
    await expect(createMember({
      doc, tables, caller: ownerCaller,
      input: { email: "a@x.com", name: "A", jobRole: "E" },
    })).rejects.toThrow(/이미 등록된 이메일/);
  });
  it("정상 케이스 — TransactWrite 호출 + Member 반환", async () => {
    const doc = mockDoc({ Items: [] }, {});
    const result = await createMember({
      doc, tables, caller: ownerCaller,
      input: { email: "a@x.com", name: "Alice", jobRole: "Engineer", teamIds: ["t1"] },
    });
    expect(result.email).toBe("a@x.com");
    expect(result.name).toBe("Alice");
    expect(doc.send).toHaveBeenCalledTimes(2); // Query email + Transact
  });
  it("teamIds 23개 초과 거부", async () => {
    const doc = mockDoc({ Items: [] });
    await expect(createMember({
      doc, tables, caller: ownerCaller,
      input: {
        email: "a@x.com", name: "A", jobRole: "E",
        teamIds: Array.from({length: 23}, (_, i) => `t${i}`),
      },
    })).rejects.toThrow(/팀 22개 초과/);
  });
});

describe("listMembers", () => {
  it("Member 권한 거부", async () => {
    const doc = mockDoc();
    await expect(listMembers({ doc, tables, caller: memberCaller })).rejects.toThrow(/권한 부족/);
  });
  it("필터 없음 — Scan 결과 모두 반환", async () => {
    const doc = mockDoc({ Items: [
      { ...ownerCaller, memberId: "m1" },
      { ...ownerCaller, memberId: "m2" },
    ]});
    const result = await listMembers({ doc, tables, caller: ownerCaller });
    expect(result).toHaveLength(2);
  });
  it("status 필터", async () => {
    const doc = mockDoc({ Items: [
      { ...ownerCaller, memberId: "m1", status: "active" },
      { ...ownerCaller, memberId: "m2", status: "removed" },
    ]});
    const result = await listMembers({ doc, tables, caller: ownerCaller, filter: { status: "ACTIVE" } });
    expect(result.map((m) => m.memberId)).toEqual(["m1"]);
  });
});

describe("getMember", () => {
  it("Member 권한 거부", async () => {
    const doc = mockDoc();
    await expect(getMember({ doc, tables, caller: memberCaller, memberId: "m1" })).rejects.toThrow();
  });
  it("정상 케이스", async () => {
    const doc = mockDoc({ Item: { ...ownerCaller, memberId: "m9" } });
    const result = await getMember({ doc, tables, caller: ownerCaller, memberId: "m9" });
    expect(result?.memberId).toBe("m9");
  });
  it("없으면 null", async () => {
    const doc = mockDoc({});
    const result = await getMember({ doc, tables, caller: ownerCaller, memberId: "m9" });
    expect(result).toBeNull();
  });
});
