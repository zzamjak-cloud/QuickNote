import { describe, it, expect, vi } from "vitest";
import {
  GqlMemberSchema,
  GqlOrganizationSchema,
  GqlTeamSchema,
  parseGqlList,
  parseGqlOne,
} from "../index";

const validMember = {
  memberId: "m1",
  email: "a@b.c",
  name: "홍길동",
  jobRole: "개발",
  workspaceRole: "MEMBER" as const,
  status: "ACTIVE" as const,
};

describe("GqlMemberSchema", () => {
  it("최소 필수 필드만 있어도 통과", () => {
    expect(GqlMemberSchema.safeParse(validMember).success).toBe(true);
  });

  it("workspaceRole 소문자도 허용", () => {
    expect(
      GqlMemberSchema.safeParse({ ...validMember, workspaceRole: "owner" }).success,
    ).toBe(true);
  });

  it("새 필드(employeeNumber 등) 누락도 OK (optional)", () => {
    const r = GqlMemberSchema.safeParse(validMember);
    expect(r.success).toBe(true);
  });

  it("memberId 누락이면 실패", () => {
    const { memberId: _omit, ...rest } = validMember;
    expect(GqlMemberSchema.safeParse(rest).success).toBe(false);
  });

  it("status 가 비표준 값이면 실패", () => {
    expect(
      GqlMemberSchema.safeParse({ ...validMember, status: "UNKNOWN" }).success,
    ).toBe(false);
  });

  it("passthrough — 알 수 없는 필드도 보존", () => {
    const r = GqlMemberSchema.safeParse({ ...validMember, futureField: "v" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect((r.data as Record<string, unknown>).futureField).toBe("v");
    }
  });
});

describe("GqlTeamSchema", () => {
  it("members 누락 시 빈 배열로 default", () => {
    const r = GqlTeamSchema.safeParse({ teamId: "t1", name: "팀" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.members).toEqual([]);
  });
  it("name 누락이면 실패", () => {
    expect(GqlTeamSchema.safeParse({ teamId: "t1" }).success).toBe(false);
  });
});

describe("GqlOrganizationSchema", () => {
  it("최소 필드 통과", () => {
    const r = GqlOrganizationSchema.safeParse({
      organizationId: "o1",
      name: "실",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.members).toEqual([]);
  });
});

describe("parseGqlList", () => {
  it("배열이 아니면 빈 배열 + 경고", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = parseGqlList(null, GqlMemberSchema, "listMembers");
    expect(out).toEqual([]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("일부 손상된 항목은 skip, 정상 항목은 유지", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = parseGqlList(
      [validMember, { broken: true }, validMember],
      GqlMemberSchema,
      "listMembers",
    );
    expect(out).toHaveLength(2);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe("parseGqlOne", () => {
  it("성공 시 데이터", () => {
    const out = parseGqlOne(validMember, GqlMemberSchema, "me");
    expect(out?.memberId).toBe("m1");
  });
  it("실패 시 null + 경고", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = parseGqlOne({}, GqlMemberSchema, "me");
    expect(out).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
