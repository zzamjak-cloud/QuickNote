import { describe, expect, it } from "vitest";
import { getSchedulerFetchWindow } from "../rangeWindow";

function startOfLocalMonthIso(year: number, month: number): string {
  return new Date(year, month, 1, 0, 0, 0, 0).toISOString();
}

function endOfLocalMonthIso(year: number, month: number): string {
  return new Date(year, month + 1, 0, 23, 59, 59, 999).toISOString();
}

describe("getSchedulerFetchWindow", () => {
  it("현재 연도에서는 이전달부터 다음달까지만 불러온다", () => {
    const result = getSchedulerFetchWindow({
      currentYear: 2026,
      now: new Date("2026-06-02T12:00:00.000Z"),
    });

    expect(result).toEqual({
      from: startOfLocalMonthIso(2026, 4),
      to: endOfLocalMonthIso(2026, 6),
    });
  });

  it("다른 연도로 이동하면 해당 연도의 1월 주변부만 불러온다", () => {
    const result = getSchedulerFetchWindow({
      currentYear: 2027,
      now: new Date("2026-06-02T12:00:00.000Z"),
    });

    expect(result).toEqual({
      from: startOfLocalMonthIso(2027, 0),
      to: endOfLocalMonthIso(2027, 1),
    });
  });
});
