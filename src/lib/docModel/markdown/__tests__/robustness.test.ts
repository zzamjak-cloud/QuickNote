import { describe, expect, it } from "vitest";
import type { DocNode } from "../../types";
import { docToQfm, qfmToDoc } from "../index";
import { normalize } from "./helpers";

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

function walk(node: DocNode, visit: (n: DocNode) => void): void {
  visit(node);
  for (const child of node.content ?? []) walk(child, visit);
}

/** 스키마의 block+ 제약(빈 컨테이너 금지)을 지키는지 검사 */
function expectNoEmptyContainers(root: DocNode): void {
  const needsContent = new Set([
    "doc", "callout", "column", "columnLayout", "toggleContent", "blockquote", "listItem",
    "taskItem", "bulletList", "orderedList", "taskList", "tableCell", "tableHeader",
  ]);
  walk(root, (n) => {
    if (needsContent.has(n.type)) expect((n.content ?? []).length, n.type).toBeGreaterThan(0);
  });
}

describe("비정상 입력 내성", () => {
  it("빈 문자열·null 류 입력", () => {
    expect(qfmToDoc("")).toEqual(EMPTY_DOC);
    expect(qfmToDoc("   \n\n  ")).toEqual(EMPTY_DOC);
    expect(qfmToDoc(null as unknown as string)).toEqual(EMPTY_DOC);
    expect(qfmToDoc(undefined as unknown as string)).toEqual(EMPTY_DOC);
    expect(qfmToDoc(42 as unknown as string)).toEqual(EMPTY_DOC);
    expect(docToQfm(null)).toBe("");
    expect(docToQfm(undefined)).toBe("");
    expect(docToQfm({ type: "doc" })).toBe("");
  });

  it("닫히지 않은 컨테이너는 문서 끝까지를 내용으로 본다", () => {
    const out = qfmToDoc("<callout>\n안쪽\n\n<details><summary>t</summary>\n깊이");
    expect(out.content?.[0]?.type).toBe("callout");
    const toggle = out.content?.[0]?.content?.[1];
    expect(toggle?.type).toBe("toggle");
    expectNoEmptyContainers(out);
  });

  it("짝 없는 닫는 태그·빈 컨테이너·단일 컬럼", () => {
    const out = qfmToDoc("</callout>\n<callout></callout>\n<columns><column>하나</column></columns>\n</details>");
    expect(out.content?.map((n) => n.type)).toEqual(["callout", "paragraph"]);
    expectNoEmptyContainers(out);
  });

  it("7열 이상 컬럼은 6열로 합친다", () => {
    const cols = Array.from({ length: 8 }, (_, i) => `<column>c${i}</column>`).join("\n");
    const out = qfmToDoc(`<columns>\n${cols}\n</columns>`);
    expect(out.content?.[0]?.content).toHaveLength(6);
    expect(out.content?.[0]?.attrs).toEqual({ columns: 6 });
  });

  it("닫히지 않은 인라인 마크·태그·링크·코드는 리터럴", () => {
    const out = qfmToDoc("**열림 _반 [링크(x `코드 <span color='red'>끝 <mention-page id=\"p\">제목");
    expect(out.content).toHaveLength(1);
    const text = (out.content?.[0]?.content ?? []).map((n) => n.text ?? "").join("");
    expect(text).toContain("**열림");
    expect(text).toContain("<span");
  });

  it("닫히지 않은 코드펜스", () => {
    const out = qfmToDoc("```py\nprint(1)\n<callout>");
    expect(out.content).toEqual([
      { type: "codeBlock", attrs: { language: "py" }, content: [{ type: "text", text: "print(1)\n<callout>" }] },
    ]);
  });

  it("깊은 중첩·대량 입력도 예외 없이 처리", () => {
    const deep = "<callout>\n".repeat(200) + "x" + "\n</callout>".repeat(200);
    expect(() => qfmToDoc(deep)).not.toThrow();
    const nested = Array.from({ length: 100 }, (_, i) => `${"  ".repeat(i)}- ${i}`).join("\n");
    expect(() => qfmToDoc(nested)).not.toThrow();
    const big = Array.from({ length: 3000 }, (_, i) => `줄 ${i} **b** _i_`).join("\n\n");
    expect(qfmToDoc(big).content).toHaveLength(3000);
  });

  it("무작위 기호 조합에도 항상 유효한 문서", () => {
    const pieces = ["*", "_", "~~", "`", "[", "]", "(", ")", "<", ">", "|", "-", "#", "\\", "\n", " ", "a", "<callout>", "</details>", "1.", "> "];
    let seed = 7;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let k = 0; k < 200; k += 1) {
      const md = Array.from({ length: 40 }, () => pieces[Math.floor(rand() * pieces.length)]).join("");
      const out = qfmToDoc(md);
      expect(out.type).toBe("doc");
      expectNoEmptyContainers(out);
      // 재직렬화도 예외 없이 동작
      expect(() => docToQfm(out)).not.toThrow();
    }
  });

  it("파싱 결과 재직렬화가 안정적(멱등) — 문단 끝 공백 차이만 허용", () => {
    const pieces = [
      "*", "_", "~~", "`", "[", "]", "(", ")", "<", ">", "|", "-", "#", "\\", "\n", " ", "a", "b ",
      "<callout>", "</callout>", "<details>", "</details>", "1.", "> ", "  ", "- [ ] ", "**", "<u>", "</u>",
      "http://x", "\n\n", "| a | b |\n|---|---|\n", "```\n",
    ];
    // 문단 끝 공백은 마크다운 특성상 보존되지 않으므로 비교에서 제외
    const trimTail = (n: DocNode): DocNode => {
      const content = (n.content ?? []).map(trimTail);
      const last = content[content.length - 1];
      if (last?.type === "text") content[content.length - 1] = { ...last, text: (last.text ?? "").trimEnd() };
      return { ...n, ...(n.content ? { content: content.filter((c) => c.type !== "text" || c.text) } : {}) };
    };
    let seed = 11;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let k = 0; k < 1500; k += 1) {
      const md = Array.from({ length: 30 }, () => pieces[Math.floor(rand() * pieces.length)]).join("");
      const first = qfmToDoc(md);
      const second = qfmToDoc(docToQfm(first));
      expect(normalize(trimTail(second)), md).toEqual(normalize(trimTail(first)));
    }
  });

  it("알 수 없는 노드·잘못된 attrs 직렬화", () => {
    const weird = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "unknownInline", content: [{ type: "text", text: "내부" }] }] },
        { type: "heading", attrs: { level: "x" } },
        { type: "bulletList" },
        { type: "text", text: "블록 위치 텍스트" },
      ],
    } as DocNode;
    expect(() => docToQfm(weird)).not.toThrow();
    expect(docToQfm(weird)).toContain("내부");
  });
});
