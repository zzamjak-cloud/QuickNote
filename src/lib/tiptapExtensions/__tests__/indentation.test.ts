import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { Indentation } from "../indentation";
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
      Toggle,
      ToggleHeader,
      ToggleContent,
      Indentation,
    ],
    content: toggleDoc,
  });
}

function runKey(editor: Editor, key: string, shiftKey = false): boolean {
  let handled = false;
  editor.view.someProp("handleKeyDown", (handler) => {
    handled = handler(editor.view, new KeyboardEvent("keydown", { key, shiftKey }));
    return handled || undefined;
  });
  return handled;
}

describe("Indentation", () => {
  it("토글 제목에서 Tab/Shift-Tab으로 토글 블록을 들여쓴다", () => {
    const editor = createEditor();

    try {
      editor.commands.setTextSelection(2);

      const beforeKey = getToggleNodeViewRenderKey(editor.state.doc.firstChild!);
      expect(runKey(editor, "Tab")).toBe(true);
      expect(editor.state.doc.firstChild?.attrs.indent).toBe(1);
      expect(getToggleNodeViewRenderKey(editor.state.doc.firstChild!)).not.toBe(beforeKey);

      expect(runKey(editor, "Tab", true)).toBe(true);
      expect(editor.state.doc.firstChild?.attrs.indent).toBe(0);
    } finally {
      editor.destroy();
    }
  });
});
