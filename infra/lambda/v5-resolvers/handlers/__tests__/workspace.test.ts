import { describe, it, expect } from "vitest";
import { computeEffectiveLevel } from "../workspace";
import type { Member } from "../_auth";

type AccessLevel = "edit" | "view";
type AccessSubjectType = "member" | "team" | "everyone";
type WorkspaceAccessEntry = {
  subjectType: AccessSubjectType;
  subjectId: string | null;
  level: AccessLevel;
};

const member = { memberId: "m1" } as unknown as Member;

describe("computeEffectiveLevel", () => {
  it("배열 첫 번째 매칭 규칙을 반환한다 (everyone보다 member 우선)", () => {
    const entries: WorkspaceAccessEntry[] = [
      { subjectType: "member", subjectId: "m1", level: "edit" },
      { subjectType: "everyone", subjectId: null, level: "view" },
    ];
    expect(computeEffectiveLevel(entries, member, new Set())).toBe("edit");
  });

  it("member 규칙이 없으면 everyone 규칙을 반환한다", () => {
    const entries: WorkspaceAccessEntry[] = [
      { subjectType: "member", subjectId: "m2", level: "edit" },
      { subjectType: "everyone", subjectId: null, level: "view" },
    ];
    expect(computeEffectiveLevel(entries, member, new Set())).toBe("view");
  });

  it("everyone-edit이 먼저 있어도 member-view가 더 높은 우선순위면 view를 반환한다", () => {
    const entries: WorkspaceAccessEntry[] = [
      { subjectType: "member", subjectId: "m1", level: "view" },
      { subjectType: "everyone", subjectId: null, level: "edit" },
    ];
    expect(computeEffectiveLevel(entries, member, new Set())).toBe("view");
  });

  it("아무 규칙도 매칭되지 않으면 null 반환", () => {
    const entries: WorkspaceAccessEntry[] = [
      { subjectType: "member", subjectId: "other", level: "edit" },
    ];
    expect(computeEffectiveLevel(entries, member, new Set())).toBeNull();
  });

  it("team 매칭", () => {
    const entries: WorkspaceAccessEntry[] = [
      { subjectType: "team", subjectId: "t1", level: "edit" },
      { subjectType: "everyone", subjectId: null, level: "view" },
    ];
    expect(computeEffectiveLevel(entries, member, new Set(["t1"]))).toBe("edit");
  });
});
