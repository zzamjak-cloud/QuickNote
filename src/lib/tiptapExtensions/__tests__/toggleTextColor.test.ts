import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Color } from "@tiptap/extension-color";
import { TextStyle } from "@tiptap/extension-text-style";
import { describe, expect, it } from "vitest";
import { BlockBackground } from "../blockBackground";
import { Toggle, ToggleContent, ToggleHeader } from "../toggle";
import { getToggleNodeViewRenderKey } from "../toggleNodeViewKey";

const toggleDoc: JSONContent = {
  type: "doc",
  content: [
    {
      type: "toggle",
      attrs: { open: true },
      content: [
        {
          type: "toggleHeader",
          content: [{ type: "text", text: "토글 제목" }],
        },
        {
          type: "toggleContent",
          content: [{ type: "paragraph" }],
        },
      ],
    },
  ],
};

function createEditor(): Editor {
  return new Editor({
    extensions: [
      StarterKit,
      TextStyle,
      Color,
      BlockBackground,
      Toggle,
      ToggleHeader,
      ToggleContent,
    ],
    content: toggleDoc,
  });
}

describe("toggle text color", () => {
  it("토글 제목 선택 영역에 인라인 텍스트 색상을 적용한다", () => {
    const editor = createEditor();

    try {
      editor.commands.setTextSelection({ from: 2, to: 7 });
      editor.commands.setColor("#ef4444");

      const toggle = editor.getJSON().content?.[0];
      const header = toggle?.content?.[0];
      const text = header?.content?.[0];

      expect(header?.type).toBe("toggleHeader");
      expect(text).toMatchObject({
        type: "text",
        text: "토글 제목",
        marks: [{ type: "textStyle", attrs: { color: "#ef4444" } }],
      });
    } finally {
      editor.destroy();
    }
  });

  it("토글 제목 placeholder 는 제목·본문이 모두 빈 경우에만 표시된다(래퍼 라이브 속성)", () => {
    const css = readFileSync(join(process.cwd(), "src/index.css"), "utf8");

    // 제목·본문이 모두 비었을 때만 placeholder 표시. summary 의 stale 속성이 아니라
    // 래퍼(.toggle-block)의 라이브 data-title-empty/data-content-empty 를 사용한다.
    expect(css).toContain(
      '.toggle-block[data-title-empty="true"][data-content-empty="true"] summary.toggle-header::after',
    );
    // 타이핑 시 갱신되지 않는 summary 자체의 data-title-empty 플레이스홀더 규칙은 없어야 한다.
    expect(css).not.toContain(
      'summary.toggle-header[data-title-empty="true"]::after',
    );
  });

  it("토글 블록 색상 attr 변경은 NodeView 리렌더 대상이다", () => {
    const editor = createEditor();

    try {
      const before = editor.state.doc.firstChild;
      editor.commands.setTextSelection(2);
      editor.commands.updateAttributes("toggle", { blockTextColor: "red" });
      const after = editor.state.doc.firstChild;

      expect(before).toBeTruthy();
      expect(after).toBeTruthy();
      expect(getToggleNodeViewRenderKey(before!)).not.toBe(getToggleNodeViewRenderKey(after!));
    } finally {
      editor.destroy();
    }
  });
});
