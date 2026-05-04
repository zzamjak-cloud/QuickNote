import {
  EDITOR_IMAGE_PLACEHOLDER_SRC,
  storeEditorImageBlob,
} from "../editorImageStorage";
import { reportNonFatal } from "../reportNonFatal";

export const MAX_EDITOR_IMAGE_BYTES = 5 * 1024 * 1024;

function loadImageDimensions(
  src: string,
): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () =>
      resolve({ w: im.naturalWidth, h: im.naturalHeight });
    im.onerror = () => resolve(null);
    im.src = src;
  });
}

export type InsertImageAttrs = {
  src: string;
  qnImageId: string | null;
  width?: number;
  height?: number;
};

/** 바이너리는 IndexedDB 에 두고 문서에는 qnImageId 만 저장해 localStorage 부담을 줄인다. */
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
    const qnImageId = await storeEditorImageBlob(file);
    const url = URL.createObjectURL(file);
    try {
      const dim = await loadImageDimensions(url);
      insert({
        src: EDITOR_IMAGE_PLACEHOLDER_SRC,
        qnImageId,
        ...(dim ? { width: dim.w, height: dim.h } : {}),
      });
      return true;
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    reportNonFatal(err, "insertImageFromFile");
    return false;
  }
}
