import { describe, it, expect, vi } from "vitest";
import {
  createMember, listMembers, getMember, buildCreateMemberTxItems,
  updateMember, updateMyClientPrefs, promoteToManager, demoteToMember,
  transferOwnership, removeMember, buildRemoveMemberPlan,
  assignMemberToTeam, unassignMemberFromTeam,
} from "./member";
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
    expect(items.filter((i) => i.Put?.TableName === "MT")).toHaveLength(2);
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
  it("Member caller도 조회 가능", async () => {
    const doc = mockDoc({ Items: [{ ...memberCaller, memberId: "m1" }] });
    const result = await listMembers({ doc, tables, caller: memberCaller });
    expect(result.map((m) => m.memberId)).toEqual(["m1"]);
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

// ─── updateMember ─────────────────────────────────────────────────────────────

const managerCaller: Member = { ...ownerCaller, memberId: "mgr-1", workspaceRole: "manager" };
const activeMember: Member = {
  ...ownerCaller, memberId: "tgt-1", workspaceRole: "member",
  email: "tgt@x.com", name: "Target", personalWorkspaceId: "ws-tgt",
};
const ownerTarget: Member = { ...ownerCaller, memberId: "owner-2", workspaceRole: "owner" };

describe("updateMember", () => {
  it("Member caller 권한 거부", async () => {
    const doc = mockDoc();
    await expect(updateMember({
      doc, tables, caller: memberCaller,
      input: { memberId: "tgt-1", name: "New" },
    })).rejects.toThrow(/권한 부족/);
  });

  it("Manager 가 Owner target 변경 시도 거부", async () => {
    const doc = mockDoc({ Item: ownerTarget });
    await expect(updateMember({
      doc, tables, caller: managerCaller,
      input: { memberId: "owner-2", name: "Hacked" },
    })).rejects.toThrow(/Owner 는 본인만 변경 가능/);
  });

  it("target not found", async () => {
    const doc = mockDoc({ Item: undefined });
    await expect(updateMember({
      doc, tables, caller: ownerCaller,
      input: { memberId: "no-such", name: "X" },
    })).rejects.toThrow(/Member 없음/);
  });

  it("정상 케이스 — name 업데이트", async () => {
    const updated = { ...activeMember, name: "New Name" };
    // GetItem → UpdateCommand → (teamIds 없으므로 여기서 끝)
    const doc = mockDoc({ Item: activeMember }, { Attributes: updated });
    const result = await updateMember({
      doc, tables, caller: ownerCaller,
      input: { memberId: "tgt-1", name: "New Name" },
    });
    expect(result.name).toBe("New Name");
  });

  it("teamIds 갱신 — Query 후 BatchWrite 호출", async () => {
    // GetItem, UpdateCommand(name), QueryCommand(existing teams), BatchWrite
    const doc = mockDoc(
      { Item: activeMember },
      { Attributes: activeMember },
      { Items: [{ memberId: "tgt-1", teamId: "old-team" }] },
      {},
    );
    await updateMember({
      doc, tables, caller: ownerCaller,
      input: { memberId: "tgt-1", teamIds: ["new-team"] },
    });
    // GetItem + Query(teams) + BatchWrite = 3 calls (no name/jobRole update)
    expect(doc.send).toHaveBeenCalledTimes(3);
  });
});

describe("updateMyClientPrefs", () => {
  const selfCaller: Member = { ...memberCaller, memberId: "self-m" };

  it("본인 clientPrefs 저장", async () => {
    const row = { ...selfCaller, memberId: "self-m", clientPrefs: null };
    const nextJson = JSON.stringify({
      v: 1,
      favoritePageIds: ["p1"],
      favoritePageIdsUpdatedAt: 100,
    });
    const doc = mockDoc(
      { Item: row },
      { Attributes: { ...row, clientPrefs: nextJson } },
    );
    const result = await updateMyClientPrefs({
      doc,
      tables,
      caller: selfCaller,
      input: { clientPrefs: nextJson },
    });
    expect(result.clientPrefs).toBe(nextJson);
    expect(doc.send).toHaveBeenCalledTimes(2);
  });

  it("서버에 더 새 prefs 가 있으면 덮어쓰지 않음", async () => {
    const existingJson = JSON.stringify({
      v: 1,
      favoritePageIds: ["keep"],
      favoritePageIdsUpdatedAt: 999,
    });
    const row = { ...selfCaller, memberId: "self-m", clientPrefs: existingJson };
    const doc = mockDoc({ Item: row });
    const staleIncoming = JSON.stringify({
      v: 1,
      favoritePageIds: ["new"],
      favoritePageIdsUpdatedAt: 1,
    });
    const result = await updateMyClientPrefs({
      doc,
      tables,
      caller: selfCaller,
      input: { clientPrefs: staleIncoming },
    });
    expect(result.clientPrefs).toBe(existingJson);
    expect(doc.send).toHaveBeenCalledTimes(1);
  });
});

// ─── promoteToManager ─────────────────────────────────────────────────────────

describe("promoteToManager", () => {
  it("Member caller 권한 거부", async () => {
    const doc = mockDoc();
    await expect(promoteToManager({ doc, tables, caller: memberCaller, memberId: "tgt-1" }))
      .rejects.toThrow(/권한 부족/);
  });

  it("이미 manager — 거부", async () => {
    const doc = mockDoc({ Item: { ...activeMember, workspaceRole: "manager" } });
    await expect(promoteToManager({ doc, tables, caller: ownerCaller, memberId: "tgt-1" }))
      .rejects.toThrow(/이미 manager/);
  });

  it("target not found", async () => {
    const doc = mockDoc({ Item: undefined });
    await expect(promoteToManager({ doc, tables, caller: ownerCaller, memberId: "no-such" }))
      .rejects.toThrow(/Member 없음/);
  });

  it("정상 케이스 — workspaceRole manager 반환", async () => {
    const promoted = { ...activeMember, workspaceRole: "manager" };
    const doc = mockDoc({ Item: activeMember }, { Attributes: promoted });
    const result = await promoteToManager({ doc, tables, caller: ownerCaller, memberId: "tgt-1" });
    expect(result.workspaceRole).toBe("manager");
  });
});

// ─── demoteToMember ───────────────────────────────────────────────────────────

describe("demoteToMember", () => {
  it("Member caller 권한 거부", async () => {
    const doc = mockDoc();
    await expect(demoteToMember({ doc, tables, caller: memberCaller, memberId: "mgr-1" }))
      .rejects.toThrow(/권한 부족/);
  });

  it("Owner target 강등 거부", async () => {
    const doc = mockDoc({ Item: ownerTarget });
    await expect(demoteToMember({ doc, tables, caller: ownerCaller, memberId: "owner-2" }))
      .rejects.toThrow(/Owner 는 강등 불가/);
  });

  it("target not found", async () => {
    const doc = mockDoc({ Item: undefined });
    await expect(demoteToMember({ doc, tables, caller: ownerCaller, memberId: "no-such" }))
      .rejects.toThrow(/Member 없음/);
  });

  it("정상 케이스 — workspaceRole member 반환", async () => {
    const mgr = { ...activeMember, workspaceRole: "manager" as const };
    const demoted = { ...mgr, workspaceRole: "member" };
    const doc = mockDoc({ Item: mgr }, { Attributes: demoted });
    const result = await demoteToMember({ doc, tables, caller: ownerCaller, memberId: "tgt-1" });
    expect(result.workspaceRole).toBe("member");
  });
});

// ─── transferOwnership ────────────────────────────────────────────────────────

describe("transferOwnership", () => {
  it("Member caller 권한 거부", async () => {
    const doc = mockDoc();
    await expect(transferOwnership({ doc, tables, caller: memberCaller, toMemberId: "mgr-1" }))
      .rejects.toThrow(/Owner 만 가능/);
  });

  it("자기 자신에게 양도 거부", async () => {
    const doc = mockDoc();
    await expect(transferOwnership({ doc, tables, caller: ownerCaller, toMemberId: ownerCaller.memberId }))
      .rejects.toThrow(/자기 자신/);
  });

  it("target not found", async () => {
    const doc = mockDoc({ Item: undefined });
    await expect(transferOwnership({ doc, tables, caller: ownerCaller, toMemberId: "no-such" }))
      .rejects.toThrow(/Member 없음/);
  });

  it("target 이 manager 아닌 경우 거부", async () => {
    const doc = mockDoc({ Item: activeMember }); // workspaceRole: member
    await expect(transferOwnership({ doc, tables, caller: ownerCaller, toMemberId: "tgt-1" }))
      .rejects.toThrow(/Manager 만 Owner 로 승격/);
  });

  it("정상 케이스 — TransactWrite 호출 + new owner 반환", async () => {
    const mgr = { ...activeMember, workspaceRole: "manager" as const };
    const doc = mockDoc({ Item: mgr }, {});
    const result = await transferOwnership({ doc, tables, caller: ownerCaller, toMemberId: "tgt-1" });
    expect(result.workspaceRole).toBe("owner");
    expect(doc.send).toHaveBeenCalledTimes(2); // GetItem + TransactWrite
  });
});

// ─── buildRemoveMemberPlan (pure) ─────────────────────────────────────────────

describe("buildRemoveMemberPlan", () => {
  it("primary 4개 항목 생성", () => {
    const plan = buildRemoveMemberPlan({
      caller: ownerCaller, target: activeMember,
      targetTeams: ["t1", "t2"],
      targetAccessEntries: [
        { workspaceId: "ws-tgt", subjectKey: "member#tgt-1" },
        { workspaceId: "ws-other", subjectKey: "member#tgt-1" },
      ],
      tables, now: "2026-05-06T00:00:00Z",
    });
    expect(plan.primaryItems).toHaveLength(4);
  });

  it("secondary: MemberTeams N개 + WorkspaceAccess entries(personal 제외)", () => {
    const plan = buildRemoveMemberPlan({
      caller: ownerCaller, target: activeMember,
      targetTeams: ["t1", "t2", "t3"],
      targetAccessEntries: [
        // personal ws access (primary 에서 처리 — secondary 에서 제외)
        { workspaceId: "ws-tgt", subjectKey: "member#tgt-1" },
        // 다른 ws access
        { workspaceId: "ws-other1", subjectKey: "member#tgt-1" },
        { workspaceId: "ws-other2", subjectKey: "member#tgt-1" },
      ],
      tables, now: "2026-05-06T00:00:00Z",
    });
    // MemberTeams 3 + WorkspaceAccess 2 (personal 제외) = 5
    expect(plan.secondaryDeletes).toHaveLength(5);
  });

  it("personal ws 의 access entry 는 secondary 에서 제외됨", () => {
    const plan = buildRemoveMemberPlan({
      caller: ownerCaller, target: activeMember,
      targetTeams: [],
      targetAccessEntries: [
        { workspaceId: "ws-tgt", subjectKey: "member#tgt-1" }, // personal — 제외
      ],
      tables, now: "2026-05-06T00:00:00Z",
    });
    expect(plan.secondaryDeletes).toHaveLength(0);
  });
});

// ─── removeMember ─────────────────────────────────────────────────────────────

describe("removeMember", () => {
  it("Member caller 권한 거부", async () => {
    const doc = mockDoc();
    await expect(removeMember({ doc, tables, caller: memberCaller, memberId: "tgt-1" }))
      .rejects.toThrow(/권한 부족/);
  });

  it("Owner target 제거 거부", async () => {
    const doc = mockDoc({ Item: ownerTarget });
    await expect(removeMember({ doc, tables, caller: ownerCaller, memberId: "owner-2" }))
      .rejects.toThrow(/Owner 는 제거 불가/);
  });

  it("target not found", async () => {
    const doc = mockDoc({ Item: undefined });
    await expect(removeMember({ doc, tables, caller: ownerCaller, memberId: "no-such" }))
      .rejects.toThrow(/Member 없음/);
  });

  it("정상 케이스 — TransactWrite + secondary batch 호출", async () => {
    // GetItem, QueryMemberTeams, QueryAccessGSI, TransactWrite, BatchWrite(teams), BatchWrite(access)
    const doc = mockDoc(
      { Item: activeMember },
      { Items: [{ memberId: "tgt-1", teamId: "t1" }] },
      { Items: [{ workspaceId: "ws-tgt", subjectKey: "member#tgt-1" }, { workspaceId: "ws-other", subjectKey: "member#tgt-1" }] },
      {}, // TransactWrite
      {}, // BatchWrite MemberTeams
      {}, // BatchWrite WorkspaceAccess
    );
    const result = await removeMember({ doc, tables, caller: ownerCaller, memberId: "tgt-1" });
    expect(result.memberId).toBe("tgt-1");
    expect(result.status).toBe("removed");
    expect(doc.send).toHaveBeenCalledTimes(6);
  });
});

// ─── assignMemberToTeam / unassignMemberFromTeam ──────────────────────────────

describe("assignMemberToTeam", () => {
  it("Member caller 권한 거부", async () => {
    const doc = mockDoc();
    await expect(assignMemberToTeam({ doc, tables, caller: memberCaller, memberId: "tgt-1", teamId: "t1" }))
      .rejects.toThrow(/권한 부족/);
  });

  it("target not found", async () => {
    const doc = mockDoc({ Item: undefined });
    await expect(assignMemberToTeam({ doc, tables, caller: ownerCaller, memberId: "no-such", teamId: "t1" }))
      .rejects.toThrow(/Member 없음/);
  });

  it("정상 케이스 — idempotent Put", async () => {
    const doc = mockDoc({ Item: activeMember }, {});
    const result = await assignMemberToTeam({ doc, tables, caller: ownerCaller, memberId: "tgt-1", teamId: "t1" });
    expect(result).toEqual({ memberId: "tgt-1", teamId: "t1" });
  });

  it("Manager caller 허용", async () => {
    const doc = mockDoc({ Item: activeMember }, {});
    const result = await assignMemberToTeam({ doc, tables, caller: managerCaller, memberId: "tgt-1", teamId: "t1" });
    expect(result.teamId).toBe("t1");
  });
});

describe("unassignMemberFromTeam", () => {
  it("Member caller 권한 거부", async () => {
    const doc = mockDoc();
    await expect(unassignMemberFromTeam({ doc, tables, caller: memberCaller, memberId: "tgt-1", teamId: "t1" }))
      .rejects.toThrow(/권한 부족/);
  });

  it("정상 케이스 — Delete 호출", async () => {
    const doc = mockDoc({});
    const result = await unassignMemberFromTeam({ doc, tables, caller: ownerCaller, memberId: "tgt-1", teamId: "t1" });
    expect(result).toEqual({ memberId: "tgt-1", teamId: "t1" });
    expect(doc.send).toHaveBeenCalledTimes(1);
  });

  it("Manager caller 허용", async () => {
    const doc = mockDoc({});
    const result = await unassignMemberFromTeam({ doc, tables, caller: managerCaller, memberId: "tgt-1", teamId: "t1" });
    expect(result.memberId).toBe("tgt-1");
  });

  it("없는 항목 삭제도 오류 없이 완료 (idempotent)", async () => {
    const doc = mockDoc({});
    await expect(
      unassignMemberFromTeam({ doc, tables, caller: ownerCaller, memberId: "tgt-1", teamId: "no-team" })
    ).resolves.toEqual({ memberId: "tgt-1", teamId: "no-team" });
  });
});
