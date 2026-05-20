import { describe, expect, it } from "vitest";
import { notionMarkdownToDoc } from "../../lib/notionImport/markdownToDoc";

describe("notionMarkdownToDoc", () => {
  it("헤딩/문단/리스트/체크리스트를 변환한다", () => {
    const md = [
      "# 제목",
      "",
      "본문 문장",
      "- 항목1",
      "- 항목2",
      "- [x] 완료",
      "- [ ] 미완료",
    ].join("\n");

    const doc = notionMarkdownToDoc(md);
    const types = (doc.content ?? []).map((node) => node.type);

    expect(types).toContain("heading");
    expect(types).toContain("paragraph");
    expect(types).toContain("bulletList");
    expect(types).toContain("taskList");
  });

  it("코드블록을 변환한다", () => {
    const md = ["```ts", "const x = 1;", "```"].join("\n");
    const doc = notionMarkdownToDoc(md);
    expect(doc.content?.[0]?.type).toBe("codeBlock");
    expect(doc.content?.[0]?.attrs).toMatchObject({ language: "ts" });
  });

  it("첫 제목 중복을 제거하고 굵은 텍스트를 mark로 변환한다", () => {
    const md = ["# CAT 생활", "", "✈️ **출퇴근 / 자리비움 / 휴가**"].join("\n");
    const doc = notionMarkdownToDoc(md, { pageTitle: "CAT 생활" });
    expect(doc.content?.[0]?.type).toBe("paragraph");
    const marks = doc.content?.[0]?.content?.[1]?.marks ?? [];
    expect(marks[0]).toMatchObject({ type: "bold" });
  });

  it("aside 블록을 callout으로 변환한다", () => {
    const md = [
      "<aside>",
      "<img src=\"https://www.notion.so/icons/info-alternate_blue.svg\" alt=\"icon\" width=\"40px\" />",
      "**Q. 질문** A. 답변",
      "</aside>",
    ].join("\n");
    const doc = notionMarkdownToDoc(md);
    expect(doc.content?.[0]?.type).toBe("callout");
    expect(doc.content?.[0]?.attrs).toMatchObject({ preset: "info" });
  });

  it("span/font 색상 스타일을 textStyle color로 변환한다", () => {
    const md = [
      "<span style=\"color: #e11d48\">빨강 텍스트</span> 일반",
      "<font color=\"#2563eb\">파랑 텍스트</font>",
    ].join("\n");
    const doc = notionMarkdownToDoc(md);
    const marks = (doc.content ?? [])
      .flatMap((node) => node.content ?? [])
      .flatMap((inline) => inline.marks ?? []);
    expect(marks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "textStyle", attrs: { color: "#e11d48" } }),
        expect.objectContaining({ type: "textStyle", attrs: { color: "#2563eb" } }),
      ]),
    );
  });

  it("글머리 들여쓰기(중첩 리스트)를 보존한다", () => {
    const md = [
      "- 상위 항목",
      "  - 하위 항목",
      "    - 3단계 항목",
    ].join("\n");
    const doc = notionMarkdownToDoc(md);
    const topList = doc.content?.[0];
    expect(topList?.type).toBe("bulletList");
    const nestedList = topList?.content?.[0]?.content?.find((c) => c.type === "bulletList");
    expect(nestedList?.type).toBe("bulletList");
    const nestedThird = nestedList?.content?.[0]?.content?.find((c) => c.type === "bulletList");
    expect(nestedThird?.type).toBe("bulletList");
  });
});
