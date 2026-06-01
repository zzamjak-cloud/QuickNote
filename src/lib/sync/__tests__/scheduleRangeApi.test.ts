import { describe, expect, it } from "vitest";
import { extractScheduleRangeSourcePages } from "../scheduleRangeApi";
import type { GqlSchedule } from "../graphql/queries/schedule";

describe("schedule range api", () => {
  it("listSchedules 응답의 sourcePage를 중복 없이 추출한다", () => {
    const page = {
      id: "page-1",
      workspaceId: "lc-scheduler-global",
      createdByMemberId: "m1",
      title: "일정 A",
      order: "a",
      doc: "{}",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    };
    const schedules = [
      { id: "page-1::member-a", sourcePage: page },
      { id: "page-1::member-b", sourcePage: page },
      { id: "page-2::member-a", sourcePage: null },
    ] as GqlSchedule[];

    expect(extractScheduleRangeSourcePages(schedules)).toEqual([page]);
  });
});
