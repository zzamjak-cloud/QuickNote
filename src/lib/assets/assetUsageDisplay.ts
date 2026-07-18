import type { GqlAssetUsage } from "../sync/graphql/operations";

export type AssetUsageDisplay = {
  title: string;
  navigable: boolean;
  hint: string;
};

/** 페이지 수명과 무관한 합성 AssetUsage를 실제 페이지 링크로 오인하지 않게 분류한다. */
export function describeAssetUsage(
  usage: GqlAssetUsage,
  pageTitle?: string,
): AssetUsageDisplay {
  if (
    usage.blockType === "customIcon" ||
    usage.pageId.startsWith("__customIcon__:")
  ) {
    return {
      title: "커스텀 아이콘 라이브러리",
      navigable: false,
      hint: "커스텀 아이콘 등록 자산",
    };
  }
  if (
    usage.blockType === "sharedGallery" ||
    usage.pageId.startsWith("__sharedBlock__:")
  ) {
    return {
      title: "공유 갤러리",
      navigable: false,
      hint: "동기화된 공유 갤러리 자산",
    };
  }
  return {
    title: pageTitle || usage.pageTitle || "(제목 없음)",
    navigable: true,
    hint: "이 페이지로 바로가기",
  };
}
