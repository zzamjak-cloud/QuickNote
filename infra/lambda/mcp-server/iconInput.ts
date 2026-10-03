// 페이지 아이콘 입력 — 앱이 쓰는 인코딩만 허용한다(src/lib/pageIcon.ts).
// 이모지 / quicknote-lucide:<Name>:<hex> / quicknote-image://<imageId>.
// 임의 http(s)·data: URL 은 외부 추적 이미지·대용량 페이로드 경로가 되므로 받지 않는다.
import { z } from "zod";

const EMOJI = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|‍|️|⃣|[#*0-9]|[\u{1F3FB}-\u{1F3FF}]|[\u{E0020}-\u{E007F}])+$/u;
const EMOJI_CORE = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const LUCIDE = /^quicknote-lucide:[A-Za-z][A-Za-z0-9]{0,63}(?::#?[0-9a-fA-F]{3,8})?$/;
const IMAGE_REF = /^quicknote-image:\/\/[A-Za-z0-9_-]{1,128}$/;
const MAX_EMOJI_LENGTH = 32;

export function isAllowedPageIcon(icon: string): boolean {
  if (LUCIDE.test(icon) || IMAGE_REF.test(icon)) return true;
  return icon.length <= MAX_EMOJI_LENGTH && EMOJI.test(icon) && EMOJI_CORE.test(icon);
}

export const pageIconInput = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(isAllowedPageIcon, {
    message: 'icon must be an emoji, "quicknote-lucide:<Name>:<hex color>" or "quicknote-image://<imageId>"',
  });
