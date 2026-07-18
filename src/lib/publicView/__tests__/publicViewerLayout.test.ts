import { describe, expect, it } from "vitest";
import {
  PUBLIC_OUTLINE_SIDEBAR_WIDTH_CLASS,
  getPublicViewerShellClassName,
} from "../publicViewerLayout";

describe("publicViewerLayout", () => {
  it("목차 사이드바 폭은 데스크톱에서 본문 축소 폭과 일치한다", () => {
    expect(PUBLIC_OUTLINE_SIDEBAR_WIDTH_CLASS).toContain("md:w-80");
    expect(getPublicViewerShellClassName(true)).toContain("md:pr-80");
  });

  it("목차가 닫히면 본문 축소 여백을 제거한다", () => {
    const className = getPublicViewerShellClassName(false);
    expect(className).toContain("md:pr-0");
    expect(className).not.toContain("md:pr-80");
  });
});
