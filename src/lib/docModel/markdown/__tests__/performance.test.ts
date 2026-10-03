import { describe, expect, it } from "vitest";
import { docToQfm, qfmToDoc } from "../index";

// 병적 입력에서 O(n²) 재스캔 회귀 방지.
// 상한은 "선형 대비 충분히 넉넉하지만 이차 회귀는 확실히 잡는" 값이다 — 이차 구현은 60KB 에서 수 초(8.7s 실측),
// 선형 구현은 로컬 ~50ms·CI 러너 ~3배 느림. 벽시계 기준을 빡빡하게 잡으면 CI 에서 플래키해진다(400KB 300ms 기준이 CI 395~485ms 로 반복 실패).
const BUDGET_MS = 1500;
const LARGE_DOC_BUDGET_MS = 3000;

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
  ])("60KB %j (%s) 선형 시간", (unit) => {
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

  it("수백 KB 일반 문서 선형 시간", () => {
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
    expect(timeParse(md)).toBeLessThan(LARGE_DOC_BUDGET_MS);
    const doc = qfmToDoc(md);
    const start = performance.now();
    docToQfm(doc);
    expect(performance.now() - start).toBeLessThan(LARGE_DOC_BUDGET_MS);
  });
});
