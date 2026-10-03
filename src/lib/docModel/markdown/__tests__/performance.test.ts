import { describe, expect, it } from "vitest";
import { docToQfm, qfmToDoc } from "../index";

// 병적 입력에서 O(n²) 재스캔 회귀 방지
const BUDGET_MS = 300;

function timeParse(md: string): number {
  const start = performance.now();
  qfmToDoc(md);
  return performance.now() - start;
}

function repeatTo(unit: string, bytes: number): string {
  return unit.repeat(Math.ceil(bytes / unit.length));
}

describe("파서 성능", () => {
  it.each([
    ["*a ", "닫히지 않는 강조"],
    ["<b>", "닫히지 않는 태그"],
    ["a\n", "줄바꿈 다수"],
    ["![", "닫히지 않는 이미지/링크"],
    ["`a ", "닫히지 않는 코드 스팬"],
    ["_a ", "닫히지 않는 밑줄 강조"],
    ["[a](<", "닫히지 않는 링크 목적지"],
    ["<mention-page id=\"x\">", "닫히지 않는 멘션"],
    ["<u>", "깊은 중첩 태그"],
  ])("60KB %j (%s) < 300ms", (unit) => {
    expect(timeParse(repeatTo(unit, 60 * 1024))).toBeLessThan(BUDGET_MS);
  });

  it("균형 잡힌 깊은 중첩(태그·강조·인용·목록)도 스택 오버플로 없이 처리", () => {
    const cases = [
      `${"<u>".repeat(5000)}x${"</u>".repeat(5000)}`,
      `${"[".repeat(5000)}x${"](u)".repeat(5000)}`,
      Array.from({ length: 300 }, (_, i) => `${">".repeat(i + 1)} q`).join("\n"),
      Array.from({ length: 300 }, (_, i) => `${"  ".repeat(i)}- n`).join("\n"),
    ];
    for (const md of cases) expect(timeParse(md)).toBeLessThan(BUDGET_MS);
  });

  it("수백 KB 일반 문서 < 300ms", () => {
    const section = [
      "## 제목 **굵게** _기울임_ `코드`",
      "",
      "문단 [링크](https://example.com) <span color=\"#ef4444\">빨강</span> <mention-page id=\"p1\">페이지</mention-page>",
      "둘째 줄",
      "",
      "- 항목 1",
      "  - 하위 항목",
      "- [ ] 할 일",
      "",
      "<callout icon=\"💡\">",
      "콜아웃 본문",
      "</callout>",
      "",
      "| a | b |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "```ts",
      "const x = 1;",
      "```",
      "",
    ].join("\n");
    const md = repeatTo(section, 400 * 1024).slice(0, 400 * 1024);
    expect(timeParse(md)).toBeLessThan(BUDGET_MS);
    const doc = qfmToDoc(md);
    const start = performance.now();
    docToQfm(doc);
    expect(performance.now() - start).toBeLessThan(BUDGET_MS);
  });
});
