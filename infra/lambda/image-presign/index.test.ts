import { describe, expect, it, beforeEach, vi } from "vitest";

describe("image-presign stable asset id", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.IMAGES_BUCKET = "bucket";
    process.env.IMAGE_ASSET_TABLE = "assets";
  });

  it("같은 사용자와 파일 지문이면 같은 업로드 ID를 만든다", async () => {
    const { createStableAssetId } = await import("./index");
    const input = {
      mimeType: "image/png",
      size: 123,
      sha256: "a".repeat(64),
    };

    expect(createStableAssetId("user-1", input)).toBe(createStableAssetId("user-1", input));
    expect(createStableAssetId("user-1", input)).toMatch(/^asset-[0-9a-f]{64}$/);
  });

  it("사용자나 파일 지문이 다르면 다른 업로드 ID를 만든다", async () => {
    const { createStableAssetId } = await import("./index");
    const input = {
      mimeType: "image/png",
      size: 123,
      sha256: "a".repeat(64),
    };

    expect(createStableAssetId("user-1", input)).not.toBe(createStableAssetId("user-2", input));
    expect(createStableAssetId("user-1", input)).not.toBe(
      createStableAssetId("user-1", { ...input, size: 124 }),
    );
  });
});
