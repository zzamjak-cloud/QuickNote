import { describe, expect, it } from "vitest";
import { collectDocAssetRefs } from "../collectDocAssets";

describe("collectDocAssetRefs galleryBlock", () => {
  it("갤러리 data 의 자산을 일반 이미지·파일과 함께 등장 순서대로 중복 없이 수집한다", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "image", attrs: { src: "quicknote-image://cover" } },
        {
          type: "galleryBlock",
          attrs: {
            data: JSON.stringify({
              kind: "gallery",
              images: [
                { id: "a", src: "quicknote-image://banner-a" },
                { id: "cover", src: "quicknote-image://cover" },
                { id: "b", src: "quicknote-file://banner-b" },
                { id: "external", src: "https://example.com/external.png" },
              ],
              intervalMs: 5_000,
            }),
          },
        },
      ],
    };
    expect(collectDocAssetRefs(doc)).toEqual([
      "quicknote-image://cover",
      "quicknote-image://banner-a",
      "quicknote-file://banner-b",
    ]);
  });

  it("객체 data 와 잘못된 JSON 을 안전하게 처리한다", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "galleryBlock",
          attrs: {
            data: {
              kind: "gallery",
              images: [{ id: "a", src: "quicknote-image://object-image" }],
            },
          },
        },
        { type: "galleryBlock", attrs: { data: "{invalid" } },
      ],
    };
    expect(collectDocAssetRefs(doc)).toEqual([
      "quicknote-image://object-image",
    ]);
  });
});
