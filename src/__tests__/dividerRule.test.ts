import { describe, it, expect } from "vitest";
import { generateHTML, generateJSON, type Extensions } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { DividerRule } from "../lib/tiptapExtensions/dividerRule";

const extensions: Extensions = [Document, Paragraph, Text, DividerRule];

// 문서 JSON → HTML 로 렌더한 뒤 hr 요소만 추출.
function renderHr(attrs: Record<string, unknown>): string {
  const html = generateHTML(
    { type: "doc", content: [{ type: "horizontalRule", attrs }] },
    extensions,
  );
  return html.match(/<hr[^>]*>/)?.[0] ?? "";
}

describe("DividerRule attrs 왕복", () => {
  it("renderHTML 이 lineStyle·color·thickness 를 data 속성과 인라인 style 로 반영한다", () => {
    const hr = renderHr({ lineStyle: "dashed", color: "#ef4444", thickness: 3 });
    expect(hr).toContain('data-line-style="dashed"');
    expect(hr).toContain('data-color="#ef4444"');
    expect(hr).toContain('data-thickness="3"');
    // jsdom 이 style 문자열을 정규화(공백·hex→rgb)하므로 느슨하게 검증.
    expect(hr).toMatch(/border-top-style:\s*dashed/);
    expect(hr).toMatch(/border-top-width:\s*3px/);
    expect(hr).toMatch(/border-top-color:\s*rgb\(239,\s*68,\s*68\)/);
  });

  it("parseHTML 이 data 속성을 attrs 로 복원한다(왕복)", () => {
    const html =
      '<hr data-line-style="dotted" data-color="#3b82f6" data-thickness="2">';
    const json = generateJSON(html, extensions);
    const hr = json.content?.[0];
    expect(hr.type).toBe("horizontalRule");
    expect(hr.attrs.lineStyle).toBe("dotted");
    expect(hr.attrs.color).toBe("#3b82f6");
    expect(hr.attrs.thickness).toBe(2);
  });

  it("속성 없는 기존 hr 은 solid/기본두께/색없음(null) 으로 하위호환된다", () => {
    const json = generateJSON("<hr>", extensions);
    const hr = json.content?.[0];
    expect(hr.attrs.lineStyle).toBe("solid");
    expect(hr.attrs.color).toBeNull();
    expect(hr.attrs.thickness).toBe(1);
    // color 가 없으면 border-top-color 를 지정하지 않아 테마색을 상속.
    const rendered = renderHr(hr.attrs);
    expect(rendered).not.toContain("border-top-color");
  });

  it("잘못된 lineStyle 값은 solid 로 정규화된다", () => {
    const json = generateJSON('<hr data-line-style="wavy">', extensions);
    expect(json.content?.[0].attrs.lineStyle).toBe("solid");
  });
});
