import { describe, expect, it } from "vitest";
import { buildWeeklyMmSuggestion, type MmScheduleSource } from "../mmSuggestion";
import { getDefaultMmWeek, shiftMmWeek, toDateKey } from "../weekUtils";
import { canEditWeeklyMmInput } from "../mmPermissions";
import { getMemberSubmissionStates, toCsvMmValue, validateMmBuckets } from "../mmValidation";

function schedule(partial: Partial<MmScheduleSource>): MmScheduleSource {
  return {
    id: partial.id ?? "s1",
    title: partial.title ?? "작업",
    startAt: partial.startAt ?? "2026-05-11T00:00:00.000Z",
    endAt: partial.endAt ?? "2026-05-11T23:59:59.999Z",
    assigneeId: partial.assigneeId ?? "m1",
    kind: partial.kind ?? "schedule",
    projectId: partial.projectId ?? null,
    teamId: partial.teamId ?? null,
    organizationId: partial.organizationId ?? null,
  };
}

describe("MM 주간 계산", () => {
  it("기본 주차는 현재 주의 이전 주 월요일이다", () => {
    expect(getDefaultMmWeek(new Date(2026, 4, 17))).toBe("2026-05-04");
    expect(shiftMmWeek("2026-05-04", 1)).toBe("2026-05-11");
  });

  it("프로젝트 4일 + 연차 1일을 80/20으로 계산한다", () => {
    const suggestion = buildWeeklyMmSuggestion({
      memberId: "m1",
      weekStart: "2026-05-11",
      schedules: [
        schedule({
          id: "p",
          title: "A",
          startAt: "2026-05-11T00:00:00.000Z",
          endAt: "2026-05-14T23:59:59.999Z",
          projectId: "p1",
        }),
        schedule({
          id: "l",
          title: "연차",
          startAt: "2026-05-15T00:00:00.000Z",
          endAt: "2026-05-15T23:59:59.999Z",
          kind: "leave",
        }),
      ],
      labels: { projects: { p1: "A프로젝트" } },
    });

    expect(suggestion.buckets.find((b) => b.id === "project:p1")?.ratioBp).toBe(8000);
    expect(suggestion.buckets.find((b) => b.id === "other")?.ratioBp).toBe(2000);
    expect(validateMmBuckets(suggestion.buckets).ok).toBe(true);
  });

  it("프로젝트 2일 + 공휴일 3일을 40/60으로 계산한다", () => {
    const suggestion = buildWeeklyMmSuggestion({
      memberId: "m1",
      weekStart: "2026-05-11",
      schedules: [
        schedule({
          id: "p",
          startAt: "2026-05-11T00:00:00.000Z",
          endAt: "2026-05-12T23:59:59.999Z",
          projectId: "p1",
        }),
      ],
      holidays: [
        { date: "2026-05-13", title: "휴일1" },
        { date: "2026-05-14", title: "휴일2" },
        { date: "2026-05-15", title: "휴일3" },
      ],
    });

    expect(suggestion.buckets.find((b) => b.id === "project:p1")?.ratioBp).toBe(4000);
    expect(suggestion.buckets.find((b) => b.id === "other")?.ratioBp).toBe(6000);
  });
});

describe("MM 검증과 권한", () => {
  it("CSV MM 값은 퍼센트가 아니라 decimal로 출력한다", () => {
    expect(toCsvMmValue(10000)).toBe("1");
    expect(toCsvMmValue(2000)).toBe("0.2");
    expect(toCsvMmValue(1250)).toBe("0.125");
  });

  it("누락/제출완료 상태를 계산한다", () => {
    const states = getMemberSubmissionStates(
      [{ memberId: "m1" }, { memberId: "m2" }],
      [{
        id: "e1",
        workspaceId: "w",
        memberId: "m1",
        weekStart: "2026-05-11",
        weekEnd: "2026-05-15",
        status: "submitted",
        buckets: [],
        submittedByMemberId: "m1",
        submittedAt: new Date(2026, 4, 16).toISOString(),
        updatedAt: new Date(2026, 4, 16).toISOString(),
      }],
      "2026-05-11",
    );
    expect(states.map((state) => state.label)).toEqual(["제출완료", "누락"]);
  });

  it("일반 구성원은 타인 MM을 수정할 수 없고 관리자는 가능하다", () => {
    expect(canEditWeeklyMmInput({
      viewer: { memberId: "m1", workspaceRole: "member", status: "active" },
      targetMemberId: "m2",
    })).toBe(false);
    expect(canEditWeeklyMmInput({
      viewer: { memberId: "admin", workspaceRole: "manager", status: "active" },
      targetMemberId: "m2",
    })).toBe(true);
    expect(canEditWeeklyMmInput({
      viewer: { memberId: "admin", workspaceRole: "manager", status: "active" },
      targetMemberId: "m2",
      status: "locked",
    })).toBe(false);
  });

  it("날짜 키는 로컬 날짜 기준으로 안정적이다", () => {
    expect(toDateKey(new Date(2026, 4, 11))).toBe("2026-05-11");
  });
});
