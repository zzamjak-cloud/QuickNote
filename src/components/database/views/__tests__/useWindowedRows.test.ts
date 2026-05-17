import { describe, expect, it } from "vitest";

function calculateWindowedRange({
  count,
  estimateSize,
  viewportTop,
  viewportHeight,
  overscan,
}: {
  count: number;
  estimateSize: number;
  viewportTop: number;
  viewportHeight: number;
  overscan: number;
}) {
  const viewportBottom = Math.min(count * estimateSize, viewportTop + viewportHeight);
  return {
    start: Math.max(0, Math.floor(viewportTop / estimateSize) - overscan),
    end: Math.min(count, Math.ceil(viewportBottom / estimateSize) + overscan),
  };
}

describe("database row window range", () => {
  it("뷰포트 주변 행만 포함한다", () => {
    expect(
      calculateWindowedRange({
        count: 1000,
        estimateSize: 32,
        viewportTop: 320,
        viewportHeight: 320,
        overscan: 2,
      }),
    ).toEqual({ start: 8, end: 22 });
  });
});
