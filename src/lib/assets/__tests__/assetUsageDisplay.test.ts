import { describe, expect, it } from "vitest";
import { describeAssetUsage } from "../assetUsageDisplay";
import type { GqlAssetUsage } from "../../sync/graphql/operations";

function usage(patch: Partial<GqlAssetUsage>): GqlAssetUsage {
  return {
    assetId: "asset-1",
    pageId: "page-1",
    workspaceId: "workspace-1",
    ...patch,
  };
}

describe("describeAssetUsage", () => {
  it("공유 갤러리 합성 사용처는 페이지 이동을 막는다", () => {
    expect(describeAssetUsage(usage({
      blockType: "sharedGallery",
      pageId: "__sharedBlock__:workspace-1:shared-1",
    }))).toEqual({
      title: "공유 갤러리",
      navigable: false,
      hint: "동기화된 공유 갤러리 자산",
    });
  });

  it("일반 페이지 사용처는 실제 페이지 제목으로 이동할 수 있다", () => {
    expect(describeAssetUsage(usage({ pageTitle: "서버 제목" }), "현재 제목")).toEqual({
      title: "현재 제목",
      navigable: true,
      hint: "이 페이지로 바로가기",
    });
  });
});
