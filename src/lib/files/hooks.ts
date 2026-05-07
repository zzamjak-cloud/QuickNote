// React 훅: file/video 노드의 src(quicknote-file://) 를 PreSignedURL 로 풀어준다.
// image 의 useImageUrl 와 동일한 패턴이지만 캐시·디코더가 분리됨.

import { useEffect, useState } from "react";
import { imageUrlCache } from "../images/registry";
import { decodeFileRef } from "./scheme";

export type UseFileUrlResult = {
  url: string | null;
  error: string | null;
};

export function useFileUrl(
  srcOrRef: string | null | undefined,
): UseFileUrlResult {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    if (!srcOrRef) {
      setUrl(null);
      setError(null);
      return;
    }
    const id = decodeFileRef(srcOrRef);
    if (!id) {
      // 일반 URL 이면 그대로 사용.
      setUrl(srcOrRef);
      setError(null);
      return;
    }
    setUrl(null);
    setError(null);
    // backend 가 image* mutation 으로 통합 처리하므로 같은 캐시·downloadUrl 흐름 재사용.
    imageUrlCache.get(id).then(
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
