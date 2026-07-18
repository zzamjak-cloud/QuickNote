import { describe, expect, it, vi } from "vitest";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { cascadeDeletePageAssetUsage, extractAssetRefs } from "./asset";

describe("galleryBlock AssetUsage 추출", () => {
  it("attrs.data JSON 의 images[].src 를 galleryBlock 사용으로 수집한다", () => {
    const doc = {
      type: "doc",
      content: [{
        type: "galleryBlock",
        attrs: {
          sharedBlockId: "shared-gallery-1",
          data: JSON.stringify({
            kind: "gallery",
            images: [
              { id: "image-1", src: "quicknote-image://asset-image" },
              { id: "file-1", src: "quicknote-file://asset-file" },
              { id: "external", src: "https://example.com/banner.png" },
            ],
            intervalMs: 5_000,
          }),
        },
      }],
    };
    expect(extractAssetRefs(doc)).toEqual([
      {
        assetId: "asset-image",
        blockId: "shared-gallery-1",
        blockType: "galleryBlock",
      },
      {
        assetId: "asset-file",
        blockId: "shared-gallery-1",
        blockType: "galleryBlock",
      },
    ]);
  });

  it("객체 data 와 잘못된 JSON 을 안전하게 처리한다", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "galleryBlock",
          attrs: {
            sharedBlockId: "shared-gallery-2",
            data: {
              kind: "gallery",
              images: [{ id: "image-2", src: "quicknote-image://asset-2" }],
            },
          },
        },
        { type: "galleryBlock", attrs: { data: "{invalid" } },
      ],
    };
    expect(extractAssetRefs(doc)).toEqual([
      {
        assetId: "asset-2",
        blockId: "shared-gallery-2",
        blockType: "galleryBlock",
      },
    ]);
  });

  it("페이지 삭제는 합성 pageId가 겹쳐도 sharedGallery usage를 보존한다", async () => {
    const syntheticPageId = "__sharedBlock__:ws-1:shared-gallery-1";
    const send = vi.fn()
      .mockResolvedValueOnce({
        Items: [
          { assetId: "page-asset", sk: "PAGE#real#BLOCK#image", blockType: "image" },
          {
            assetId: "gallery-asset",
            sk: "SHARED_BLOCK#ws-1#shared-gallery-1",
            blockType: "sharedGallery",
          },
        ],
      })
      .mockResolvedValueOnce({});

    await cascadeDeletePageAssetUsage({
      doc: { send } as unknown as DynamoDBDocumentClient,
      tables: {
        Members: "Members",
        Teams: "Teams",
        MemberTeams: "MemberTeams",
        Workspaces: "Workspaces",
        WorkspaceAccess: "WorkspaceAccess",
        AssetUsage: "AssetUsage",
      },
      pageId: syntheticPageId,
    });

    const batch = (send.mock.calls[1]?.[0] as {
      input?: { RequestItems?: Record<string, Array<Record<string, unknown>>> };
    }).input?.RequestItems?.AssetUsage;
    expect(batch).toEqual([{
      DeleteRequest: { Key: { assetId: "page-asset", sk: "PAGE#real#BLOCK#image" } },
    }]);
  });
});
