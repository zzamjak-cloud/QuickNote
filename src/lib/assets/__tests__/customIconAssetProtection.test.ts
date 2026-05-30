import { describe, expect, it } from "vitest";
import { collectCustomIconAssetIds } from "../customIconAssetProtection";

describe("customIconAssetProtection", () => {
  it("커스텀 아이콘 src에서 보호할 자산 id를 수집한다", () => {
    const ids = collectCustomIconAssetIds([
      { src: "quicknote-image://asset-a" },
      { src: "quicknote-file://asset-b#preview" },
      { src: "https://example.com/icon.png" },
      { src: null },
    ]);

    expect(Array.from(ids).sort()).toEqual(["asset-a", "asset-b"]);
  });
});
