// 에디터 doc 안 file/video 노드의 src 표현 — 가상 스킴.
// image 와 동일한 backend 인프라를 재사용하지만 노드 타입을 구분하기 위해 별도 스킴 사용.

export const FILE_SCHEME = "quicknote-file://";

export function encodeFileRef(fileId: string): string {
  return `${FILE_SCHEME}${fileId}`;
}

export function decodeFileRef(value: string): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith(FILE_SCHEME)) return null;
  const id = value.slice(FILE_SCHEME.length);
  return id.length > 0 ? id : null;
}

export function isFileRef(value: string): boolean {
  return decodeFileRef(value) !== null;
}
