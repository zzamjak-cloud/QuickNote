// React 훅: TipTap 노드 src(quicknote-image:// 또는 일반 URL)를 표시 가능한 URL 로 풀어준다.

import { useEffect, useState } from "react";
import { imageUrlCache } from "./registry";
import { decodeImageRef } from "../sync/imageScheme";
import { decodeFileRef } from "../files/scheme";
import {
  writeMediaBlob,
  fetchMediaBlob,
  getMediaObjectUrl,
  peekMediaObjectUrl,
  rememberMediaObjectUrl,
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

// 동기 캐시 조회 — 이미 풀려있는 이미지 URL 을 즉시 반환(없으면 null).
// 에디터 리마운트(협업 바인딩 등) 시 캐시가 따뜻하면 placeholder 플래시 없이 즉시 그리기 위해
// NodeView 가 lazy-activation 초기값 결정에도 사용한다. 캐시는 모듈 싱글톤이라 리마운트에도 유지된다.
export function initialImageUrl(srcOrRef: string | null | undefined): string | null {
  if (!srcOrRef) return null;
  const id = decodeImageRef(srcOrRef) ?? decodeFileRef(srcOrRef);
  if (!id) return srcOrRef;
  // 인메모리 object URL 캐시가 있으면 동기로 즉시 반환 — 재진입 시 로딩 플래시 제거.
  return peekMediaObjectUrl(id) ?? imageUrlCache.peek(id) ?? null;
}

// 협업 수신 직후 자산 confirm/AssetUsage 전파 전이라 presign 이 일시적으로 실패(403 등)할 수 있다.
// 새로고침 없이 자가 치유하도록 백오프로 몇 회 재시도한다. (초기 시도 포함 총 시도 횟수)
const IMAGE_RESOLVE_MAX_ATTEMPTS = 4;
const IMAGE_RESOLVE_BASE_DELAY_MS = 700;

export function useImageUrl(
  srcOrRef: string | null | undefined,
): UseImageUrlResult {
  const [url, setUrl] = useState<string | null>(() =>
    initialImageUrl(srcOrRef),
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
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
    // 동기 인메모리 캐시 적중이면 추가 작업 없이 즉시 표시.
    const memUrl = peekMediaObjectUrl(id);
    if (memUrl) {
      setUrl(memUrl);
      return () => {
        canceled = true;
      };
    }
    // PreSignedURL 다운로드(+blob 캐싱). 실패 시 전파 레이스로 보고 백오프 재시도.
    const resolveFromNetwork = async (attempt: number): Promise<void> => {
      try {
        const downloadUrl = await imageUrlCache.get(id);
        if (canceled) return;
        // 바이트 fetch (CORS 비활성 시 null 반환 → 추가 요청·콘솔 스팸 없음).
        const blob = await fetchMediaBlob(downloadUrl);
        if (canceled) return;
        if (blob) {
          setUrl(rememberMediaObjectUrl(id, blob));
          void writeMediaBlob(id, blob, { maxItemBytes: IMAGE_CACHE_MAX_BYTES });
          return;
        }
        // 바이트 캐싱 불가 — PreSignedURL 직접 사용(<img> 는 CORS 불필요).
        setUrl(downloadUrl);
      } catch (e) {
        if (canceled) return;
        // 자산 전파 전 일시 실패면 재시도해 자가 치유. 마지막 시도까지 실패 시에만 에러 표시.
        if (attempt < IMAGE_RESOLVE_MAX_ATTEMPTS - 1) {
          retryTimer = setTimeout(() => {
            if (!canceled) void resolveFromNetwork(attempt + 1);
          }, IMAGE_RESOLVE_BASE_DELAY_MS * 2 ** attempt);
          return;
        }
        setError(mapImageErrorMessage(e));
      }
    };
    void (async () => {
      // 1) 로컬 blob 캐시(인메모리→IndexedDB) — 네트워크 없이 object URL 표시.
      const cachedUrl = await getMediaObjectUrl(id);
      if (canceled) return;
      if (cachedUrl) {
        setUrl(cachedUrl);
        return;
      }
      // 2) 미스 — TTL 캐시 URL 이 있으면 먼저 보여주고, PreSignedURL 로 다운로드(+재시도) 후 blob 캐싱.
      setUrl(imageUrlCache.peek(id) ?? null);
      await resolveFromNetwork(0);
    })();
    return () => {
      canceled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [srcOrRef]);

  return { url, error };
}
