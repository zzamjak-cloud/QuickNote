// 에디터 doc 안 image 노드 src 표현 — 가상 스킴.
// 영구 imageId 만 보유하고, 표시 시 PreSignedURL 로 변환한다.

export const IMAGE_SCHEME = "quicknote-image://";

export function encodeImageRef(imageId: string): string {
  return `${IMAGE_SCHEME}${imageId}`;
}

export function decodeImageRef(value: string): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith(IMAGE_SCHEME)) return null;
  const id = value.slice(IMAGE_SCHEME.length);
  return id.length > 0 ? id : null;
}

export function isImageRef(value: string): boolean {
  return decodeImageRef(value) !== null;
}
