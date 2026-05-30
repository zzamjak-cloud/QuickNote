import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { EmojiShortcode, findEmojiShortcode, resolveEmojiShortcode } from "../emojiShortcode";

function createEditor(content = "<p></p>"): Editor {
  return new Editor({
    extensions: [StarterKit, EmojiShortcode],
    content,
  });
}

describe("emojiShortcode", () => {
  it(":키워드 치환용 이모지를 반환한다", () => {
    expect(resolveEmojiShortcode("체크")).toBe("✅");
    expect(resolveEmojiShortcode("핀")).toBe("📌");
    expect(resolveEmojiShortcode("pin")).toBe("📌");
  });

  it("등록되지 않은 키워드는 null", () => {
    expect(resolveEmojiShortcode("없는키워드")).toBeNull();
  });

  it("커서 앞 :키워드 패턴만 감지한다", () => {
    expect(findEmojiShortcode(":체크")).toMatchObject({
      emoji: "✅",
      keyword: "체크",
      shortcodeLength: 3,
    });
    expect(findEmojiShortcode("할 일 :핀")).toMatchObject({
      emoji: "📌",
      keyword: "핀",
      shortcodeLength: 2,
    });
    expect(findEmojiShortcode("본문:체크")).toBeNull();
  });

  it(":키워드만 입력했을 때는 아직 바꾸지 않는다", () => {
    const editor = createEditor();
    try {
      editor.commands.setTextSelection(1);
      let handled = false;
      editor.view.someProp("handleTextInput", (handler) => {
        handled = handler(editor.view, 1, 1, ":체크");
        return handled || undefined;
      });

      expect(handled).toBe(false);
      expect(editor.getText()).toBe("");
    } finally {
      editor.destroy();
    }
  });

  it(":키워드 뒤 스페이스 입력에서 이모지와 공백으로 바꾼다", () => {
    const editor = createEditor("<p>:체크</p>");
    try {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      let handled = false;
      editor.view.someProp("handleTextInput", (handler) => {
        const pos = editor.state.selection.from;
        handled = handler(editor.view, pos, pos, " ");
        return handled || undefined;
      });

      expect(handled).toBe(true);
      expect(editor.getText()).toBe("✅ ");
    } finally {
      editor.destroy();
    }
  });

  it("Space keydown에서도 이모지와 공백으로 바꾼다", () => {
    const editor = createEditor("<p>:핀</p>");
    try {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      let handled = false;
      editor.view.someProp("handleKeyDown", (handler) => {
        handled = handler(editor.view, new KeyboardEvent("keydown", { key: " " }));
        return handled || undefined;
      });

      expect(handled).toBe(true);
      expect(editor.getText()).toBe("📌 ");
    } finally {
      editor.destroy();
    }
  });
});
