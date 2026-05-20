// React 훅: TipTap 노드 src(quicknote-image:// 또는 일반 URL)를 표시 가능한 URL 로 풀어준다.

import { useEffect, useState } from "react";
import { imageUrlCache } from "./registry";
import { decodeImageRef } from "../sync/imageScheme";
import { decodeFileRef } from "../files/scheme";

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
    const cached = imageUrlCache.peek(id);
    if (cached) {
      setUrl(cached);
      return () => {
        canceled = true;
      };
    }
    setUrl(null);
    void imageUrlCache.get(id).then(
      (u) => {
        if (!canceled) setUrl(u);
      },
      (e) => {
        if (!canceled) setError(mapImageErrorMessage(e));
      },
    );
    return () => {
      canceled = true;
    };
  }, [srcOrRef]);

  return { url, error };
}
