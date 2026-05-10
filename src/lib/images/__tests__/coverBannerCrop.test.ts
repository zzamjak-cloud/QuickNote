import { describe, expect, it } from "vitest";
import { coverBannerCropSource } from "../compressImage";

describe("coverBannerCropSource", () => {
  const aspect = 4;

  it("정사각형 원본은 상하를 줄여 가로형 배너 비율로 만든다", () => {
    const { sx, sy, sw, sh } = coverBannerCropSource(1000, 1000, aspect);
    expect(sw / sh).toBeCloseTo(aspect, 5);
    expect(sx).toBe(0);
    expect(sy).toBeGreaterThan(0);
    expect(sh).toBeLessThan(1000);
  });

  it("매우 넓은 원본은 세로 전체·가로만 크롭", () => {
    const { sx, sy, sw, sh } = coverBannerCropSource(4000, 400, aspect);
    expect(sh).toBe(400);
    expect(sw).toBe(1600);
    expect(sx).toBe(1200);
    expect(sy).toBe(0);
  });

  it("세로로 긴 원본은 가로 전체·세로만 크롭", () => {
    const { sx, sy, sw, sh } = coverBannerCropSource(400, 2000, aspect);
    expect(sw).toBe(400);
    expect(sh).toBe(100);
    expect(sx).toBe(0);
    expect(sy).toBe(950);
  });
});
