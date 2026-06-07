import { describe, expect, it } from "vitest";
import {
  resolveDatabaseInitialRowLimit,
  resolveDatabaseVisibleRowLimit,
} from "../databaseRowLimit";

describe("databaseRowLimit", () => {
  it("inline은 itemLimit를 초기 row limit로 사용한다", () => {
    expect(resolveDatabaseInitialRowLimit("inline", 30)).toBe(30);
  });

  it("fullPage도 itemLimit를 초기 row limit로 사용한다", () => {
    expect(resolveDatabaseInitialRowLimit("fullPage", 30)).toBe(30);
    expect(
      resolveDatabaseVisibleRowLimit({
        layout: "fullPage",
        itemLimit: 30,
        totalRows: 150,
        extraRows: 0,
      }),
    ).toBe(30);
  });

  it("itemLimit가 없고 100개 미만이면 강제 클리핑하지 않는다", () => {
    expect(
      resolveDatabaseVisibleRowLimit({
        layout: "fullPage",
        itemLimit: undefined,
        totalRows: 99,
        extraRows: 0,
      }),
    ).toBeUndefined();
  });
});
