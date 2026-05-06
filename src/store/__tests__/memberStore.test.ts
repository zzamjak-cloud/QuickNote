import { beforeEach, describe, expect, it } from "vitest";
import { useMemberStore, type Member, type MemberMini } from "../memberStore";

function makeMember(partial: Partial<Member> & { memberId: string; email: string; name: string }): Member {
  return {
    memberId: partial.memberId,
    email: partial.email,
    name: partial.name,
    jobRole: partial.jobRole ?? "Engineer",
    workspaceRole: partial.workspaceRole ?? "member",
    status: partial.status ?? "active",
    personalWorkspaceId: partial.personalWorkspaceId ?? `ws-${partial.memberId}`,
  };
}

function makeMini(partial: Partial<MemberMini> & { memberId: string; name: string }): MemberMini {
  return {
    memberId: partial.memberId,
    name: partial.name,
    jobRole: partial.jobRole ?? "Engineer",
  };
}

describe("memberStore", () => {
  beforeEach(() => {
    useMemberStore.getState().clear();
  });

  it("me 정보를 저장/갱신한다", () => {
    const me = makeMember({ memberId: "m1", email: "m1@x.com", name: "Kim" });
    useMemberStore.getState().setMe(me);
    expect(useMemberStore.getState().me?.memberId).toBe("m1");

    const updated = { ...me, name: "Kim Updated" };
    useMemberStore.getState().setMe(updated);
    expect(useMemberStore.getState().me?.name).toBe("Kim Updated");
  });

  it("멤버 목록 캐시를 교체하고 upsert로 업데이트한다", () => {
    useMemberStore.getState().setMembers([
      makeMember({ memberId: "m1", email: "m1@x.com", name: "A" }),
      makeMember({ memberId: "m2", email: "m2@x.com", name: "B" }),
    ]);
    expect(useMemberStore.getState().members).toHaveLength(2);

    useMemberStore
      .getState()
      .upsertMember(makeMember({ memberId: "m2", email: "m2@x.com", name: "B2" }));
    expect(useMemberStore.getState().members.find((m) => m.memberId === "m2")?.name).toBe("B2");
  });

  it("removeMemberFromCache는 목록/나/멘션 캐시에서 제거한다", () => {
    useMemberStore.getState().setMe(
      makeMember({ memberId: "m1", email: "m1@x.com", name: "A" }),
    );
    useMemberStore.getState().setMembers([
      makeMember({ memberId: "m1", email: "m1@x.com", name: "A" }),
      makeMember({ memberId: "m2", email: "m2@x.com", name: "B" }),
    ]);
    useMemberStore.getState().setMentionCandidates("a", [
      makeMini({ memberId: "m1", name: "A" }),
      makeMini({ memberId: "m2", name: "B" }),
    ]);

    useMemberStore.getState().removeMemberFromCache("m1");
    const state = useMemberStore.getState();
    expect(state.members.map((m) => m.memberId)).toEqual(["m2"]);
    expect(state.me).toBeNull();
    expect(state.mentionCandidates.map((m) => m.memberId)).toEqual(["m2"]);
  });

  it("멘션 검색 캐시를 query와 함께 저장하고 clearMentions로 초기화한다", () => {
    useMemberStore.getState().setMentionCandidates("al", [
      makeMini({ memberId: "m1", name: "Alice" }),
    ]);
    expect(useMemberStore.getState().mentionQuery).toBe("al");
    expect(useMemberStore.getState().mentionCandidates).toHaveLength(1);

    useMemberStore.getState().clearMentions();
    expect(useMemberStore.getState().mentionQuery).toBe("");
    expect(useMemberStore.getState().mentionCandidates).toHaveLength(0);
  });
});
