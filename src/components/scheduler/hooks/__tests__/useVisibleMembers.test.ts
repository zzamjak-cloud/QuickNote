import { describe, expect, it } from "vitest";
import type { Member } from "../../../../store/memberStore";
import { sortMembersBySchedulerOrder } from "../useVisibleMembers";

function member(memberId: string, name: string): Member {
  return {
    memberId,
    email: `${memberId}@example.com`,
    name,
    jobRole: "",
    workspaceRole: "member",
    status: "active",
    personalWorkspaceId: `${memberId}-workspace`,
  };
}

describe("sortMembersBySchedulerOrder", () => {
  it("저장된 구성원 탭 순서를 우선하고 나머지는 기존 이름 정렬을 유지한다", () => {
    const sorted = sortMembersBySchedulerOrder(
      [member("member-1", "가람"), member("member-2", "나래"), member("member-3", "다온")],
      ["member-3", "member-1"],
    );

    expect(sorted.map((item) => item.memberId)).toEqual([
      "member-3",
      "member-1",
      "member-2",
    ]);
  });
});
