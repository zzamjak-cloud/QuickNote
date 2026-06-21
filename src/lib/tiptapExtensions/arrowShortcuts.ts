import { Extension, textInputRule } from "@tiptap/core";

/**
 * 화살표 단축 입력. 스페이스바로 변환을 트리거한다.
 *   `<-> ` → `↔ ` (양방향)
 *   `<- `  → `← ` (왼쪽)
 *   `-> `  → `→ ` (오른쪽)
 * `<->` 가 `->`/`<-` 를 포함하므로 더 긴 패턴을 먼저 둔다.
 * 코드블록·인라인코드 안에서는 tiptap 입력룰 플러그인이 자동으로 건너뛴다.
 */
export const ArrowShortcuts = Extension.create({
  name: "arrowShortcuts",
  addInputRules() {
    return [
      textInputRule({ find: /<->\s$/, replace: "↔ " }),
      textInputRule({ find: /<-\s$/, replace: "← " }),
      textInputRule({ find: /->\s$/, replace: "→ " }),
    ];
  },
});
