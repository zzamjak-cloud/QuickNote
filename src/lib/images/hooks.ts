// React 훅: TipTap 노드 src(quicknote-image:// 또는 일반 URL)를 표시 가능한 URL 로 풀어준다.

import { useEffect, useState } from "react";
import { imageUrlCache } from "./registry";
import { decodeImageRef } from "../sync/imageScheme";
import { decodeFileRef } from "../files/scheme";
import {
  readMediaBlob,
  writeMediaBlob,
  fetchMediaBlob,
  IMAGE_CACHE_MAX_BYTES,
} from "../media/mediaBlobCache";

export type UseImageUrlResult = {
  url: string | null;
  error: string | null;
};

function mapImageErrorMessage(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();
  if (
    lower.includes("unauthorized") ||
    lower.includes("not authorized") ||
    lower.includes("no valid auth token") ||
    lower.includes("401")
  ) {
    return "이미지 접근 권한이 만료되었습니다. 다시 로그인해 주세요.";
  }
  return msg;
}

function initialImageUrl(srcOrRef: string | null | undefined): string | null {
  if (!srcOrRef) return null;
  const id = decodeImageRef(srcOrRef) ?? decodeFileRef(srcOrRef);
  if (!id) return srcOrRef;
  return imageUrlCache.peek(id) ?? null;
}

export function useImageUrl(
  srcOrRef: string | null | undefined,
): UseImageUrlResult {
  const [url, setUrl] = useState<string | null>(() =>
    initialImageUrl(srcOrRef),
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    if (!srcOrRef) {
      setUrl(null);
      setError(null);
      return;
    }
    const id = decodeImageRef(srcOrRef) ?? decodeFileRef(srcOrRef);
    if (!id) {
      // 일반 URL(또는 data:)은 그대로 사용.
      setUrl(srcOrRef);
      setError(null);
      return;
    }
    setError(null);
    let objectUrl: string | null = null;
    const applyBlobUrl = (blob: Blob) => {
      objectUrl = URL.createObjectURL(blob);
      if (!canceled) setUrl(objectUrl);
    };
    void (async () => {
      // 1) 로컬 IndexedDB blob 캐시 우선 — 네트워크 없이 즉시 표시.
      const localBlob = await readMediaBlob(id);
      if (canceled) return;
      if (localBlob) {
        applyBlobUrl(localBlob);
        return;
      }
      // 2) 미스 — TTL 캐시 URL 이 있으면 먼저 보여주고, PreSignedURL 로 1회 다운로드 후 blob 캐싱.
      setUrl(imageUrlCache.peek(id) ?? null);
      try {
        const downloadUrl = await imageUrlCache.get(id);
        if (canceled) return;
        // 바이트 fetch (CORS 비활성 시 null 반환 → 추가 요청·콘솔 스팸 없음).
        const blob = await fetchMediaBlob(downloadUrl);
        if (canceled) return;
        if (blob) {
          applyBlobUrl(blob);
          void writeMediaBlob(id, blob, { maxItemBytes: IMAGE_CACHE_MAX_BYTES });
          return;
        }
        // 바이트 캐싱 불가 — PreSignedURL 직접 사용(<img> 는 CORS 불필요).
        setUrl(downloadUrl);
      } catch (e) {
        if (!canceled) setError(mapImageErrorMessage(e));
      }
    })();
    return () => {
      canceled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [srcOrRef]);

  return { url, error };
}
