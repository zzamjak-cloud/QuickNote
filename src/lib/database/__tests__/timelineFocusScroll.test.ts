import { describe, expect, it } from "vitest";

import { timelineFocusScrollLeft } from "../timelineGeometry";

describe("timelineFocusScrollLeft", () => {
  it("일정 시작일의 하루 전 셀이 sticky 항목 열 오른쪽 첫 날짜 칸에 오도록 계산한다", () => {
    expect(timelineFocusScrollLeft({
      cardLeft: 10 * 32,
      pxPerDay: 32,
      maxLeft: 1000,
    })).toBe(9 * 32);
  });

  it("시작일이 첫 날짜 칸이면 음수로 스크롤하지 않는다", () => {
    expect(timelineFocusScrollLeft({
      cardLeft: 0,
      pxPerDay: 32,
      maxLeft: 1000,
    })).toBe(0);
  });

  it("컨텐츠 끝을 넘어가지 않도록 최대 scrollLeft로 제한한다", () => {
    expect(timelineFocusScrollLeft({
      cardLeft: 40 * 32,
      pxPerDay: 32,
      maxLeft: 500,
    })).toBe(500);
  });
});
