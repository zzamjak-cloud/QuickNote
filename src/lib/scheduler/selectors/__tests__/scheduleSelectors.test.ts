import { describe, expect, it } from "vitest";
import { filterSchedulesByRange, groupSchedulesByMember } from "../scheduleSelectors";
import type { Schedule } from "../../../../store/schedulerStore";

function schedule(partial: Partial<Schedule>): Schedule {
  return {
    id: partial.id ?? "s1",
    workspaceId: partial.workspaceId ?? "w",
    title: partial.title ?? "일정",
    projectId: partial.projectId ?? null,
    startAt: partial.startAt ?? "2026-05-11T00:00:00.000Z",
    endAt: partial.endAt ?? "2026-05-11T23:59:59.999Z",
    assigneeId: "assigneeId" in partial ? partial.assigneeId : "m1",
    createdByMemberId: partial.createdByMemberId ?? "m1",
    createdAt: partial.createdAt ?? "2026-05-11T00:00:00.000Z",
    updatedAt: partial.updatedAt ?? "2026-05-11T00:00:00.000Z",
  };
}

describe("schedule selectors", () => {
  it("visible range와 겹치는 일정만 남긴다", () => {
    const schedules = [
      schedule({ id: "in", startAt: "2026-05-12T00:00:00.000Z", endAt: "2026-05-12T23:59:59.999Z" }),
      schedule({ id: "out", startAt: "2026-06-01T00:00:00.000Z", endAt: "2026-06-01T23:59:59.999Z" }),
    ];

    expect(filterSchedulesByRange(
      schedules,
      "2026-05-01T00:00:00.000Z",
      "2026-05-31T23:59:59.999Z",
    ).map((item) => item.id)).toEqual(["in"]);
  });

  it("프로젝트 필터를 반영해 구성원 일정과 특이사항을 분리한다", () => {
    const grouped = groupSchedulesByMember([
      schedule({ id: "m1", assigneeId: "m1", projectId: "p1" }),
      schedule({ id: "global", assigneeId: null, projectId: "p1" }),
      schedule({ id: "hidden", assigneeId: "m2", projectId: "p2" }),
    ], "p1");

    expect(grouped.schedulesByMember.m1?.map((item) => item.id)).toEqual(["m1"]);
    expect(grouped.globalSchedules.map((item) => item.id)).toEqual(["global"]);
    expect(grouped.schedulesByMember.m2).toBeUndefined();
  });
});
