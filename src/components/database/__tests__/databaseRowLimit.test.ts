import { describe, expect, it } from "vitest";
import {
  resolveDatabaseInitialRowLimit,
  resolveDatabaseVisibleRowLimit,
} from "../databaseRowLimit";

describe("databaseRowLimit", () => {
  it("inline은 itemLimit를 초기 row limit로 사용한다", () => {
    expect(resolveDatabaseInitialRowLimit("inline", 30)).toBe(30);
  });

  it("fullPage는 inline itemLimit를 무시하고 기본 100개를 사용한다", () => {
    expect(resolveDatabaseInitialRowLimit("fullPage", 30)).toBe(100);
    expect(
      resolveDatabaseVisibleRowLimit({
        layout: "fullPage",
        itemLimit: 30,
        totalRows: 150,
        extraRows: 0,
      }),
    ).toBe(100);
  });

  it("100개 미만 fullPage는 강제 클리핑하지 않는다", () => {
    expect(
      resolveDatabaseVisibleRowLimit({
        layout: "fullPage",
        itemLimit: 10,
        totalRows: 99,
        extraRows: 0,
      }),
    ).toBeUndefined();
  });
});
