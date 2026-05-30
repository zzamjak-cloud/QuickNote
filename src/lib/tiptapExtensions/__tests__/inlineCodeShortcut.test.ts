import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { InlineCodeShortcut } from "../inlineCodeShortcut";

function createEditor(content = "<p></p>"): Editor {
  return new Editor({
    extensions: [StarterKit, InlineCodeShortcut],
    content,
  });
}

describe("InlineCodeShortcut", () => {
  function expectInlineCodeDoc(editor: Editor) {
    expect(editor.getText()).toBe("입력정보");
    expect(editor.getJSON()).toMatchObject({
      content: [
        {
          content: [
            {
              text: "입력정보",
              marks: [{ type: "code" }],
            },
          ],
        },
      ],
    });
  }

  it("닫는 백틱 입력 시 백틱을 제거하고 인라인 코드 mark만 남긴다", () => {
    const editor = createEditor("<p>`입력정보</p>");
    try {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      let handled = false;
      editor.view.someProp("handleTextInput", (handler) => {
        const pos = editor.state.selection.from;
        handled = handler(editor.view, pos, pos, "`");
        return handled || undefined;
      });

      expect(handled).toBe(true);
      expectInlineCodeDoc(editor);
    } finally {
      editor.destroy();
    }
  });

  it("선택 영역에 백틱을 입력하면 백틱 없이 인라인 코드 mark를 적용한다", () => {
    const editor = createEditor("<p>입력정보</p>");
    try {
      editor.commands.setTextSelection({ from: 1, to: 5 });
      let handled = false;
      editor.view.someProp("handleTextInput", (handler) => {
        handled = handler(editor.view, 1, 5, "`");
        return handled || undefined;
      });

      expect(handled).toBe(true);
      expectInlineCodeDoc(editor);
    } finally {
      editor.destroy();
    }
  });

  it("선택 영역에서 백틱 keydown도 인라인 코드 mark를 적용한다", () => {
    const editor = createEditor("<p>입력정보</p>");
    try {
      editor.commands.setTextSelection({ from: 1, to: 5 });
      let handled = false;
      editor.view.someProp("handleKeyDown", (handler) => {
        handled = handler(editor.view, new KeyboardEvent("keydown", { key: "`" }));
        return handled || undefined;
      });

      expect(handled).toBe(true);
      expectInlineCodeDoc(editor);
    } finally {
      editor.destroy();
    }
  });
});
