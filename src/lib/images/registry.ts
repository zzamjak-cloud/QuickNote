// imageId → PreSignedURL 캐시(앱 전역 싱글턴). 만료 직전(50분)까지 재사용.

import { ImageUrlCache } from "../sync/imageUrls";
import { appsyncClient } from "../sync/graphql/client";
import { GET_IMAGE_DOWNLOAD_URL } from "../sync/graphql/operations";

type GetImageDownloadUrlResponse = {
  data: { getImageDownloadUrl: string };
};

export const imageUrlCache = new ImageUrlCache(async (imageId) => {
  const r = await appsyncClient().graphql({
    query: GET_IMAGE_DOWNLOAD_URL,
    variables: { imageId },
  });
  const errors = (r as unknown as { errors?: { message?: string }[] }).errors;
  if (errors?.length) {
    throw new Error(errors[0]?.message ?? `이미지 URL 조회 실패: ${imageId}`);
  }
  const url = (r as GetImageDownloadUrlResponse).data?.getImageDownloadUrl;
  if (!url) throw new Error(`이미지 URL 없음: ${imageId}`);
  return url;
}, 50 * 60 * 1000);
