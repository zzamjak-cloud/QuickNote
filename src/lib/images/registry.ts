// imageId → PreSignedURL 캐시(앱 전역 싱글턴). 만료 직전(50분)까지 재사용.

import { ImageUrlCache } from "../sync/imageUrls";
import { appsyncClient } from "../sync/graphql/client";
import { GET_IMAGE_DOWNLOAD_URL } from "../sync/graphql/operations";

type GetImageDownloadUrlResponse = {
  data: { getImageDownloadUrl: string };
};

export const imageUrlCache = new ImageUrlCache(async (imageId) => {
  const r = (await appsyncClient().graphql({
    query: GET_IMAGE_DOWNLOAD_URL,
    variables: { imageId },
  })) as GetImageDownloadUrlResponse;
  return r.data.getImageDownloadUrl;
}, 50 * 60 * 1000);
