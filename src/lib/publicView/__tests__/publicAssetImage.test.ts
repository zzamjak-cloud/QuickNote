import { describe, expect, it } from "vitest";
import { publicAssetImageCrossOrigin } from "../publicAssetImage";

describe("publicAssetImageCrossOrigin", () => {
  it("공개 asset URL 에만 anonymous CORS 를 적용한다", () => {
    expect(
      publicAssetImageCrossOrigin(
        "https://cdn.example/?op=asset&token=token-1&pageId=page-1&assetId=asset-1&cors=1&v=snap-1",
      ),
    ).toBe("anonymous");
  });

  it("일반 이미지 URL 과 quicknote ref 에는 적용하지 않는다", () => {
    expect(publicAssetImageCrossOrigin("https://cdn.example/image.webp")).toBeUndefined();
    expect(publicAssetImageCrossOrigin("quicknote-image://asset-1")).toBeUndefined();
    expect(publicAssetImageCrossOrigin(null)).toBeUndefined();
  });
});
