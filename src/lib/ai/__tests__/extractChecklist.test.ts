import { describe, expect, it } from "vitest";
import {
  checklistMarkdownForInsert,
  extractChecklistMarkdown,
  looksLikeChecklist,
} from "../extractChecklist";

describe("extractChecklistMarkdown", () => {
  it("서문·후문이 있어도 체크리스트만 남긴다", () => {
    const raw = `다음은 할 일입니다.\n\n- [ ] 초안 작성\n- [x] 리뷰\n\n끝.`;
    expect(extractChecklistMarkdown(raw)).toBe("- [ ] 초안 작성\n- [x] 리뷰");
    expect(looksLikeChecklist(raw)).toBe(true);
  });

  it("항목이 없으면 null", () => {
    expect(extractChecklistMarkdown("실행 항목이 없습니다.")).toBeNull();
    expect(checklistMarkdownForInsert("실행 항목이 없습니다.")).toBe("실행 항목이 없습니다.");
  });
});
