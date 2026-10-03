import { describe, expect, it } from "vitest";
import type { DocNode } from "../../types";
import { QFM_MAX_INPUT_BYTES, QfmError, qfmToDoc } from "../index";

function inlineOf(md: string): DocNode[] {
  return qfmToDoc(md).content?.[0]?.content ?? [];
}

describe("인라인 속성 태그 URL 필터", () => {
  it("버튼 href 의 javascript: 는 제거", () => {
    const [button] = inlineOf('<button href="javascript:alert(1)">x</button>');
    expect(button).toEqual({ type: "buttonBlock", attrs: { label: "x" } });
  });

  it("인라인 이미지 src 가 위험하면 노드를 버린다", () => {
    expect(JSON.stringify(qfmToDoc('a <inline-image src="javascript:alert(1)"/> b'))).not.toContain("javascript");
    expect(inlineOf('<inline-image src=" JaVa\tScRiPt:x"/>z')).toEqual([{ type: "text", text: "z" }]);
  });

  it("블록 속성 태그도 같은 필터를 쓴다", () => {
    const out = qfmToDoc('<bookmark href="vbscript:x" title="t"/>\n\n<image src="data:image/png;base64,AA"/>');
    expect(out.content).toEqual([{ type: "bookmarkBlock", attrs: { title: "t" } }]);
  });
});

describe("색 속성 검증", () => {
  it("허용 형식(hex·rgb·이름·토큰)은 유지", () => {
    const md = [
      '<span color="#abc">a</span>',
      '<span color="#11223344">b</span>',
      '<span color="rgba(1, 2, 3, 0.5)">c</span>',
      '<mark color="yellow">d</mark>',
      '<icon name="Star" color="darkGray"/>',
    ].join("");
    const colors = inlineOf(md).map((n) => n.marks?.[0]?.attrs?.color ?? n.attrs?.color);
    expect(colors).toEqual(["#abc", "#11223344", "rgba(1, 2, 3, 0.5)", "yellow", "darkGray"]);
  });

  it("그 외 형식은 무시(마크/속성 없이 텍스트만)", () => {
    const md =
      '<span color="red;background:url(x)">a</span><span style="color: expression(alert(1))">b</span>' +
      '<mark color="#12">c</mark><icon name="Star" color="url(javascript:x)"/>';
    const nodes = inlineOf(md);
    expect(nodes[0]).toEqual({ type: "text", text: "ab" });
    expect(nodes[1]).toEqual({ type: "text", text: "c", marks: [{ type: "highlight" }] });
    expect(nodes[2]).toEqual({ type: "lucideInlineIcon", attrs: { name: "Star" } });
  });
});

describe("날짜 태그", () => {
  it("값 없으면 버리고, 형식이 틀리면 텍스트로 강등", () => {
    expect(inlineOf('a<date/>b')).toEqual([{ type: "text", text: "ab" }]);
    expect(inlineOf('<date value="내일"/>')).toEqual([{ type: "text", text: "내일" }]);
    expect(inlineOf('<date value="2026-13-01"/>')).toEqual([{ type: "text", text: "2026-13-01" }]);
    expect(inlineOf('<date value="2026-02-28"/>')).toEqual([{ type: "dateInline", attrs: { value: "2026-02-28" } }]);
  });
});

describe("입력 크기 상한", () => {
  it("512KB 초과는 INPUT_TOO_LARGE", () => {
    expect(() => qfmToDoc("a".repeat(QFM_MAX_INPUT_BYTES + 1))).toThrow(
      expect.objectContaining({ code: "INPUT_TOO_LARGE" }),
    );
    // 한글은 3바이트 — 문자 수가 아니라 UTF-8 바이트로 판정
    expect(() => qfmToDoc("가".repeat(Math.ceil(QFM_MAX_INPUT_BYTES / 3) + 1))).toThrow(QfmError);
    expect(() => qfmToDoc("a".repeat(QFM_MAX_INPUT_BYTES))).not.toThrow();
  });
});
