// 드래그·붙여넣기 등 비-모달 경로에서 이미지를 v4 S3 로 업로드 후 노드 삽입.

import { uploadImage } from "../images/upload";
import { prepareImageFileForUpload } from "../images/compressImage";
import { reportNonFatal } from "../reportNonFatal";

export const MAX_EDITOR_IMAGE_BYTES = 20 * 1024 * 1024;

function loadImageDimensions(
  src: string,
): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight });
    im.onerror = () => resolve(null);
    im.src = src;
  });
}

export type InsertImageAttrs = {
  src: string;
  width?: number;
  height?: number;
};

/** v4: 파일을 S3 에 업로드하고 quicknote-image:// ref 를 src 로 삽입한다. */
export async function insertImageFromFile(
  file: File,
  insert: (attrs: InsertImageAttrs) => void,
  opts?: {
    maxBytes?: number;
    onSizeExceeded?: (sizeMb: number) => void;
  },
): Promise<boolean> {
  const maxBytes = opts?.maxBytes ?? MAX_EDITOR_IMAGE_BYTES;
  if (file.size > maxBytes) {
    opts?.onSizeExceeded?.(file.size / 1024 / 1024);
    return false;
  }
  try {
    const prepared = await prepareImageFileForUpload(file);
    const url = URL.createObjectURL(prepared);
    let dim: { w: number; h: number } | null = null;
    try {
      dim = await loadImageDimensions(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const ref = await uploadImage(prepared);
    insert({
      src: ref,
      ...(dim ? { width: dim.w, height: dim.h } : {}),
    });
    return true;
  } catch (err) {
    reportNonFatal(err, "insertImageFromFile");
    return false;
  }
}
