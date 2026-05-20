// imageId → PreSignedURL 캐시(앱 전역 싱글턴). 만료 직전(50분)까지 재사용.

import { ImageUrlCache } from "../sync/imageUrls";
import { appsyncClient } from "../sync/graphql/client";
import { GET_IMAGE_DOWNLOAD_URL } from "../sync/graphql/operations";
import { ensureFreshTokensForAppSync } from "../auth/apiTokens";
import { webStorage } from "../storage/web";

type GetImageDownloadUrlResponse = {
  data: { getImageDownloadUrl: string };
};

type PersistedImageUrl = {
  url: string;
  expiresAt: number;
};

const IMAGE_URL_CACHE_PREFIX = "quicknote.image.cache.url.";
const MEMORY_TTL_MS = 50 * 60 * 1000;
const PERSIST_TTL_MS = 45 * 60 * 1000;
const EXPIRE_SKEW_MS = 30 * 1000;

function cacheKey(imageId: string): string {
  return `${IMAGE_URL_CACHE_PREFIX}${imageId}`;
}

function isUnauthorizedMessage(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("unauthorized") ||
    m.includes("not authorized") ||
    m.includes("no valid auth token") ||
    m.includes("401")
  );
}

function parseGraphqlErrorMessage(result: unknown): string | null {
  const errors = (result as { errors?: { message?: string }[] } | null)?.errors;
  if (!errors?.length) return null;
  return errors[0]?.message ?? "GraphQL 요청 실패";
}

async function readPersistedUrl(imageId: string): Promise<string | null> {
  try {
    const raw = await webStorage.getItem(cacheKey(imageId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedImageUrl>;
    if (
      typeof parsed.url !== "string" ||
      typeof parsed.expiresAt !== "number"
    ) {
      return null;
    }
    if (parsed.expiresAt <= Date.now() + EXPIRE_SKEW_MS) {
      await webStorage.removeItem(cacheKey(imageId));
      return null;
    }
    return parsed.url;
  } catch {
    return null;
  }
}

async function writePersistedUrl(imageId: string, url: string): Promise<void> {
  const payload: PersistedImageUrl = {
    url,
    expiresAt: Date.now() + PERSIST_TTL_MS,
  };
  try {
    await webStorage.setItem(cacheKey(imageId), JSON.stringify(payload));
  } catch {
    // 캐시 저장 실패는 렌더 실패로 취급하지 않는다.
  }
}

async function requestImageUrl(imageId: string): Promise<string> {
  const exec = async (): Promise<unknown> =>
    appsyncClient().graphql({
      query: GET_IMAGE_DOWNLOAD_URL,
      variables: { imageId },
    });

  let result = await exec();
  let message = parseGraphqlErrorMessage(result);
  if (message && isUnauthorizedMessage(message)) {
    await ensureFreshTokensForAppSync();
    result = await exec();
    message = parseGraphqlErrorMessage(result);
  }
  if (message) throw new Error(message);

  const url = (result as GetImageDownloadUrlResponse).data?.getImageDownloadUrl;
  if (!url) throw new Error(`이미지 URL 없음: ${imageId}`);
  await writePersistedUrl(imageId, url);
  return url;
}

export const imageUrlCache = new ImageUrlCache(async (imageId) => {
  const persisted = await readPersistedUrl(imageId);
  if (persisted) return persisted;
  return requestImageUrl(imageId);
}, MEMORY_TTL_MS);
