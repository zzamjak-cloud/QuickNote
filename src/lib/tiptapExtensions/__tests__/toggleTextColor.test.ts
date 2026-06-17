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

  it("토글 블록 색상이 빈 제목 회색 규칙에 가려지지 않는다", () => {
    const css = readFileSync(join(process.cwd(), "src/index.css"), "utf8");

    expect(css).toContain(
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
