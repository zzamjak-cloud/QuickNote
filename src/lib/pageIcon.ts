// 페이지 icon 필드: 이모지 텍스트 vs 이미지 ref/URL 판별

import { decodeImageRef } from "./sync/imageScheme";

/** quicknote-image:// ref 인지 */
export function isQuickNoteImageIcon(icon: string | null | undefined): boolean {
  if (!icon) return false;
  return decodeImageRef(icon) !== null;
}

/** img 태그로 표시할 수 있는 아이콘(원격·data URL·가상 ref) */
export function isImageLikePageIcon(icon: string | null | undefined): boolean {
  if (!icon) return false;
  if (isQuickNoteImageIcon(icon)) return true;
  if (icon.startsWith("http://") || icon.startsWith("https://")) return true;
  if (icon.startsWith("data:image/")) return true;
  return false;
}
