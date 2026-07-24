import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { focusBodyStartWithEmptyBlock } from "../focusBodyStartWithEmptyBlock";

function createEditor(content: JSONContent): Editor {
  return new Editor({
    extensions: [StarterKit],
    content,
  });
}

describe("focusBodyStartWithEmptyBlock", () => {
  it("본문에 콘텐츠가 있으면 첫 줄에 빈 문단을 삽입하고 커서를 둔다", () => {
    const editor = createEditor({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "기존 본문" }] }],
    });

    try {
      expect(focusBodyStartWithEmptyBlock(editor)).toBe(true);

      const json = editor.getJSON();
      expect(json.content?.[0]).toEqual({ type: "paragraph" });
      expect(json.content?.[1]?.content?.[0]?.text).toBe("기존 본문");
      expect(editor.state.selection.from).toBe(1);
    } finally {
      editor.destroy();
    }
  });

  it("첫 줄이 이미 빈 문단이면 중복 삽입하지 않고 그 문단에 포커스한다", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "기존 본문" }] },
      ],
    });

    try {
      expect(focusBodyStartWithEmptyBlock(editor)).toBe(true);

      const json = editor.getJSON();
      expect(json.content).toHaveLength(2);
      expect(json.content?.[0]).toEqual({ type: "paragraph" });
      expect(json.content?.[1]?.content?.[0]?.text).toBe("기존 본문");
      expect(editor.state.selection.from).toBe(1);
    } finally {
      editor.destroy();
    }
  });
});
