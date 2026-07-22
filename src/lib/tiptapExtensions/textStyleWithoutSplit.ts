import { TextStyle } from "@tiptap/extension-text-style";

/**
 * 인라인 텍스트 색은 현재 줄에서만 유지한다.
 *
 * TextStyle 기본값은 블록 분할(Enter) 뒤에도 mark를 보존하므로, 색이 설정된
 * 제목/본문 끝에서 Enter를 누르면 새 줄의 입력까지 같은 색으로 이어진다.
 * 굵게·기울임 같은 별도 mark는 그대로 두고 TextStyle(color)만 분할 시 해제한다.
 */
export const TextStyleWithoutSplit = TextStyle.extend({
  keepOnSplit: false,
});
