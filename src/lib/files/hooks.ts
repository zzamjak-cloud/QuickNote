// React 훅: file/video 노드의 src(quicknote-file://) 를 PreSignedURL 로 풀어준다.
// image 의 useImageUrl 와 동일한 패턴이지만 캐시·디코더가 분리됨.

import { useEffect, useState } from "react";
import { imageUrlCache } from "../images/registry";
import { decodeImageRef } from "../sync/imageScheme";
import { decodeFileRef } from "./scheme";
import {
  readMediaBlob,
  writeMediaBlob,
  fetchMediaBlob,
  VIDEO_CACHE_MAX_BYTES,
} from "../media/mediaBlobCache";

export type UseFileUrlResult = {
  url: string | null;
  error: string | null;
};

/** 로컬 blob 캐싱 판단용 힌트 (fileBlock 노드의 size/mime). */
export type FileCacheHint = {
  sizeBytes?: number;
  mime?: string;
};

/** 첫 페인트부터 TTL 캐시 URL 반영 — 에디터 입력 시 노드뷰 재마운트해도 동영상 깜빡임 최소화 */
function initialFileUrl(srcOrRef: string | null | undefined): string | null {
  if (!srcOrRef) return null;
  const id = decodeFileRef(srcOrRef) ?? decodeImageRef(srcOrRef);
  if (!id) return srcOrRef;
  return imageUrlCache.peek(id) ?? null;
}

export function useFileUrl(
  srcOrRef: string | null | undefined,
  cacheHint?: FileCacheHint,
): UseFileUrlResult {
  const [url, setUrl] = useState<string | null>(() =>
    initialFileUrl(srcOrRef),
  );
  const [error, setError] = useState<string | null>(null);
  const hintSize = cacheHint?.sizeBytes;

  useEffect(() => {
    let canceled = false;
    let objectUrl: string | null = null;
    if (!srcOrRef) {
      setUrl(null);
      setError(null);
      return;
    }
    // 초기 파일 첨부는 이미지 업로드 인프라를 그대로 써서 quicknote-image:// 로
    // 저장된 문서가 있을 수 있다. 파일 노드에서는 두 ref 스킴 모두 downloadUrl 로 푼다.
    const id = decodeFileRef(srcOrRef) ?? decodeImageRef(srcOrRef);
    if (!id) {
      // 일반 URL 이면 그대로 사용.
      setUrl(srcOrRef);
      setError(null);
      return;
    }
    setError(null);
    void (async () => {
      // 1) 로컬 blob 캐시 우선 — 네트워크 없이 즉시 표시.
      const localBlob = await readMediaBlob(id);
      if (canceled) return;
      if (localBlob) {
        objectUrl = URL.createObjectURL(localBlob);
        setUrl(objectUrl);
        return;
      }
      // 2) 미스 — TTL 캐시 URL 이 있으면 먼저 보여주고 PreSignedURL 로딩.
      const peeked = imageUrlCache.peek(id);
      setUrl(peeked ?? null);
      try {
        const downloadUrl = await imageUrlCache.get(id);
        if (canceled) return;
        setUrl(downloadUrl);
        // 3) 백그라운드 캐싱: 크기 힌트가 한도(소형 동영상/파일) 이하일 때만.
        // 대형 동영상은 캐싱하지 않고 PreSignedURL 스트리밍을 그대로 둔다.
        if (hintSize != null && hintSize > 0 && hintSize <= VIDEO_CACHE_MAX_BYTES) {
          void (async () => {
            // CORS 비활성 시 null → 백그라운드 요청 없음 (재생은 PreSignedURL 로 정상 동작).
            const blob = await fetchMediaBlob(downloadUrl);
            if (blob) await writeMediaBlob(id, blob, { maxItemBytes: VIDEO_CACHE_MAX_BYTES });
          })();
        }
      } catch (e) {
        if (!canceled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      canceled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [srcOrRef, hintSize]);

  return { url, error };
}
