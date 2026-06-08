import { describe, expect, it } from "vitest";
import {
  DEFAULT_DATABASE_VISIBLE_ROW_LIMIT,
  MIN_DATABASE_INLINE_ROW_LIMIT,
  resolveDatabaseInitialRowLimit,
  resolveDatabaseVisibleRowLimit,
} from "../databaseRowLimit";

describe("databaseRowLimit", () => {
  it("inline은 itemLimit를 초기 row limit로 사용한다", () => {
    expect(resolveDatabaseInitialRowLimit("inline", 30)).toBe(30);
  });

  it("inline itemLimit가 최소값보다 작으면 최소 표시 개수로 보정한다", () => {
    const invalidInlineLimit = MIN_DATABASE_INLINE_ROW_LIMIT - 1;

    expect(resolveDatabaseInitialRowLimit("inline", invalidInlineLimit)).toBe(
      MIN_DATABASE_INLINE_ROW_LIMIT,
    );
    expect(
      resolveDatabaseVisibleRowLimit({
        layout: "inline",
        itemLimit: invalidInlineLimit,
        totalRows: 150,
        extraRows: 0,
      }),
    ).toBe(MIN_DATABASE_INLINE_ROW_LIMIT);
  });

  it("fullPage는 inline itemLimit와 독립적으로 기본 row limit를 사용한다", () => {
    expect(resolveDatabaseInitialRowLimit("fullPage", 30)).toBe(
      DEFAULT_DATABASE_VISIBLE_ROW_LIMIT,
    );
    expect(
      resolveDatabaseVisibleRowLimit({
        layout: "fullPage",
        itemLimit: 30,
        totalRows: 150,
        extraRows: 0,
      }),
    ).toBe(DEFAULT_DATABASE_VISIBLE_ROW_LIMIT);
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
