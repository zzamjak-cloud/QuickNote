import { describe, it, expect } from "vitest";
import {
  computeEffectiveLevel,
  isAtLeast,
  hasRoleAtLeast,
  unauthorized,
  forbidden,
  badRequest,
  preventOwnerMutation,
  type AccessEntry,
} from "./auth";

describe("computeEffectiveLevel", () => {
  it("멤버 직접 매칭 시 그 level 반환", () => {
    const entries: AccessEntry[] = [
      { subjectType: "member", subjectId: "m1", level: "edit" },
    ];
    expect(computeEffectiveLevel(entries, "m1", [])).toBe("edit");
  });

  it("팀 매칭 (멤버가 그 팀에 속함)", () => {
    const entries: AccessEntry[] = [
      { subjectType: "team", subjectId: "t1", level: "edit" },
    ];
    expect(computeEffectiveLevel(entries, "m1", ["t1", "t2"])).toBe("edit");
  });

  it("everyone view + 팀 edit 동시 매칭 → edit (더 높은 권한)", () => {
    const entries: AccessEntry[] = [
      { subjectType: "team", subjectId: "t1", level: "edit" },
      { subjectType: "everyone", subjectId: null, level: "view" },
    ];
    expect(computeEffectiveLevel(entries, "m1", ["t1"])).toBe("edit");
  });

  it("everyone view 만 매칭 → view", () => {
    const entries: AccessEntry[] = [
      { subjectType: "team", subjectId: "t1", level: "edit" },
      { subjectType: "everyone", subjectId: null, level: "view" },
    ];
    expect(computeEffectiveLevel(entries, "m1", ["t9"])).toBe("view");
  });

  it("매칭 없음 → null", () => {
    const entries: AccessEntry[] = [
      { subjectType: "team", subjectId: "t1", level: "edit" },
    ];
    expect(computeEffectiveLevel(entries, "m1", ["t9"])).toBeNull();
  });

  it("빈 entries → null", () => {
    expect(computeEffectiveLevel([], "m1", ["t1"])).toBeNull();
  });

  it("멤버 + 팀 양쪽 매칭 → 더 높은 level", () => {
    const entries: AccessEntry[] = [
      { subjectType: "member", subjectId: "m1", level: "view" },
      { subjectType: "team", subjectId: "t1", level: "edit" },
    ];
    expect(computeEffectiveLevel(entries, "m1", ["t1"])).toBe("edit");
  });

  it("subjectId null 인 team entry 는 매칭 안 됨 (안전)", () => {
    const entries: AccessEntry[] = [
      { subjectType: "team", subjectId: null, level: "edit" },
    ];
    expect(computeEffectiveLevel(entries, "m1", ["t1"])).toBeNull();
  });
});

describe("isAtLeast", () => {
  it("edit ≥ view", () => {
    expect(isAtLeast("edit", "view")).toBe(true);
  });
  it("view < edit", () => {
    expect(isAtLeast("view", "edit")).toBe(false);
  });
  it("null 이면 false", () => {
    expect(isAtLeast(null, "view")).toBe(false);
  });
  it("동일 level 은 true", () => {
    expect(isAtLeast("edit", "edit")).toBe(true);
  });
});

describe("hasRoleAtLeast", () => {
  it("owner ≥ manager", () => {
    expect(hasRoleAtLeast("owner", "manager")).toBe(true);
  });
  it("member < manager", () => {
    expect(hasRoleAtLeast("member", "manager")).toBe(false);
  });
  it("동일 역할 → true", () => {
    expect(hasRoleAtLeast("manager", "manager")).toBe(true);
  });
});

describe("error throws", () => {
  it("unauthorized 는 errorType=Unauthorized", () => {
    try {
      unauthorized("msg");
      expect.fail("should throw");
    } catch (e) {
      expect((e as Error & { errorType?: string }).errorType).toBe("Unauthorized");
      expect((e as Error).message).toBe("msg");
    }
  });
  it("forbidden 는 errorType=Forbidden", () => {
    try {
      forbidden("msg");
      expect.fail();
    } catch (e) {
      expect((e as Error & { errorType?: string }).errorType).toBe("Forbidden");
    }
  });
  it("badRequest 는 errorType=BadRequest", () => {
    try {
      badRequest("msg");
      expect.fail();
    } catch (e) {
      expect((e as Error & { errorType?: string }).errorType).toBe("BadRequest");
    }
  });
});

describe("preventOwnerMutation", () => {
  it("owner caller 가 owner target 변경 — 통과 (transferOwnership 등)", () => {
    expect(() => preventOwnerMutation("owner", "owner")).not.toThrow();
  });
  it("manager caller 가 owner target 변경 — 거부", () => {
    expect(() => preventOwnerMutation("manager", "owner")).toThrow(/Owner/);
  });
  it("manager caller 가 member target 변경 — 통과", () => {
    expect(() => preventOwnerMutation("manager", "member")).not.toThrow();
  });
  it("manager caller 가 manager target 변경 — 통과", () => {
    expect(() => preventOwnerMutation("manager", "manager")).not.toThrow();
  });
});
