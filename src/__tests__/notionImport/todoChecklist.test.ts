import { describe, expect, it } from "vitest";
import { notionHtmlToDoc } from "../../lib/notionImport/htmlToDoc";

type N = { type?: string; attrs?: Record<string, unknown>; content?: N[] };

describe("Notion 체크박스(to-do) 가져오기", () => {
  it("ul.to-do-list 를 taskList/taskItem 으로 변환하고 checked 상태를 보존한다 (checkbox-on/off)", () => {
    const html =
      '<html><body><article class="page">' +
      '<ul class="to-do-list">' +
      '<li><div class="checkbox checkbox-on"></div><span class="to-do-children-checked">완료 항목</span></li>' +
      '<li><div class="checkbox checkbox-off"></div><span class="to-do-children-unchecked">미완료 항목</span></li>' +
      "</ul>" +
      "</article></body></html>";
    const doc = notionHtmlToDoc(html) as N;
    const list = doc.content?.[0];
    expect(list?.type).toBe("taskList");
    expect(list?.content?.[0]?.type).toBe("taskItem");
    expect(list?.content?.[0]?.attrs?.checked).toBe(true);
    expect(list?.content?.[1]?.attrs?.checked).toBe(false);
  });

  it("input[type=checkbox][checked] 형태도 checked 로 인식", () => {
    const html =
      '<html><body><article class="page">' +
      '<ul class="to-do-list">' +
      '<li><input type="checkbox" checked disabled/>완료</li>' +
      '<li><input type="checkbox" disabled/>미완료</li>' +
      "</ul>" +
      "</article></body></html>";
    const doc = notionHtmlToDoc(html) as N;
    const list = doc.content?.[0];
    expect(list?.type).toBe("taskList");
    expect(list?.content?.[0]?.attrs?.checked).toBe(true);
    expect(list?.content?.[1]?.attrs?.checked).toBe(false);
  });

  it("일반 ul 은 그대로 bulletList", () => {
    const html =
      '<html><body><article class="page"><ul><li>그냥 항목</li></ul></article></body></html>';
    const doc = notionHtmlToDoc(html) as N;
    expect(doc.content?.[0]?.type).toBe("bulletList");
  });
});
