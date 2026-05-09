// React 훅: TipTap 노드 src(quicknote-image:// 또는 일반 URL)를 표시 가능한 URL 로 풀어준다.

import { useEffect, useState } from "react";
import { imageUrlCache } from "./registry";
import { decodeImageRef } from "../sync/imageScheme";

export type UseImageUrlResult = {
  url: string | null;
  error: string | null;
};

function initialImageUrl(srcOrRef: string | null | undefined): string | null {
  if (!srcOrRef) return null;
  const id = decodeImageRef(srcOrRef);
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
    const id = decodeImageRef(srcOrRef);
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
        if (!canceled) setError(String(e));
      },
    );
    return () => {
      canceled = true;
    };
  }, [srcOrRef]);

  return { url, error };
}
