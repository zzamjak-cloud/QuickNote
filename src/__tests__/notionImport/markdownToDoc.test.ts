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

  it("GFM 표(헤더+본문)를 table 노드로 변환한다", () => {
    const md = [
      "| 이름 | 나이 |",
      "| --- | --- |",
      "| 철수 | 20 |",
      "| 영희 | 21 |",
    ].join("\n");
    const doc = notionMarkdownToDoc(md);
    const table = doc.content?.[0];
    expect(table?.type).toBe("table");

    const rows = table?.content ?? [];
    expect(rows.length).toBe(3); // 헤더 1 + 본문 2
    expect(rows.every((r) => r.type === "tableRow")).toBe(true);

    // 첫 행은 tableHeader, 이후는 tableCell. 각 셀 content 는 paragraph
    const headerRow = rows[0];
    expect(headerRow?.content?.every((c) => c.type === "tableHeader")).toBe(true);
    expect(headerRow?.content?.[0]?.content?.[0]?.type).toBe("paragraph");

    const bodyRow = rows[1];
    expect(bodyRow?.content?.every((c) => c.type === "tableCell")).toBe(true);
    expect(bodyRow?.content?.[0]?.content?.[0]?.type).toBe("paragraph");

    // 헤더 텍스트 확인
    const headerText = headerRow?.content?.[0]?.content?.[0]?.content?.[0]?.text;
    expect(headerText).toBe("이름");
  });

  it("정렬 구분선(:--:, --:)이 있어도 표로 인식한다", () => {
    const md = [
      "| L | C | R |",
      "| :--- | :--: | ---: |",
      "| a | b | c |",
    ].join("\n");
    const doc = notionMarkdownToDoc(md);
    const table = doc.content?.[0];
    expect(table?.type).toBe("table");
    expect(table?.content?.length).toBe(2);
    expect(table?.content?.[0]?.content?.length).toBe(3);
  });

  it("셀 안의 인라인 마크(bold/code/link)를 변환한다", () => {
    const md = [
      "| 항목 | 값 |",
      "| --- | --- |",
      "| **굵게** | `코드` |",
    ].join("\n");
    const doc = notionMarkdownToDoc(md);
    const bodyRow = doc.content?.[0]?.content?.[1];
    const boldCell = bodyRow?.content?.[0]?.content?.[0]?.content?.[0];
    expect(boldCell?.marks?.[0]).toMatchObject({ type: "bold" });
    const codeCell = bodyRow?.content?.[1]?.content?.[0]?.content?.[0];
    expect(codeCell?.marks?.[0]).toMatchObject({ type: "code" });
  });

  it("escape 된 파이프(\\|)는 셀 내용으로 보존한다", () => {
    const md = [
      "| 식 | 결과 |",
      "| --- | --- |",
      "| a \\| b | true |",
    ].join("\n");
    const doc = notionMarkdownToDoc(md);
    const bodyRow = doc.content?.[0]?.content?.[1];
    expect(bodyRow?.content?.length).toBe(2); // 셀이 3개로 쪼개지지 않아야 함
    const firstCellText = bodyRow?.content?.[0]?.content?.[0]?.content?.[0]?.text;
    expect(firstCellText).toBe("a | b");
  });

  it("불규칙 열 수: 부족분은 빈 셀 채우고 초과분은 버린다", () => {
    const md = [
      "| A | B | C |",
      "| --- | --- | --- |",
      "| 1 |", // 부족
      "| 1 | 2 | 3 | 4 |", // 초과
    ].join("\n");
    const doc = notionMarkdownToDoc(md);
    const rows = doc.content?.[0]?.content ?? [];
    // 모든 행의 셀 수가 헤더(3)와 동일해야 함
    expect(rows.every((r) => r.content?.length === 3)).toBe(true);
  });

  it("구분선이 없으면 표로 인식하지 않는다(문단으로)", () => {
    const md = [
      "| 그냥 | 텍스트 |",
      "| 두번째 | 줄 |",
    ].join("\n");
    const doc = notionMarkdownToDoc(md);
    expect(doc.content?.[0]?.type).not.toBe("table");
  });
});
