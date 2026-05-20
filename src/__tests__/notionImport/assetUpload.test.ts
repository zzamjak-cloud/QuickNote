import { describe, expect, it, vi } from "vitest";
import { uploadNotionAsset } from "../../lib/notionImport/assetUpload";
import type { NotionImportedAsset } from "../../lib/notionImport/zipParser";

describe("uploadNotionAsset", () => {
  it("대형 GIF는 브라우저 ffmpeg 변환을 시도하지 않고 실패 첨부로 남긴다", async () => {
    const readAsFile = vi.fn(async () => new File(["gif"], "large.gif", { type: "image/gif" }));
    const asset: NotionImportedAsset = {
      path: "media/large.gif",
      name: "large.gif",
      mimeType: "image/gif",
      size: 63 * 1024 * 1024,
      readAsFile,
    };

    const uploaded = await uploadNotionAsset(asset);

    expect(uploaded.kind).toBe("failed");
    expect(readAsFile).not.toHaveBeenCalled();
  });
});
