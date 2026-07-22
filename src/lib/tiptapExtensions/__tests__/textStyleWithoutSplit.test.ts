import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Color } from "@tiptap/extension-color";
import { describe, expect, it } from "vitest";
import { BlockBackground } from "../blockBackground";
import { TextStyleWithoutSplit } from "../textStyleWithoutSplit";

function pressEnter(editor: Editor): boolean {
  const event = new KeyboardEvent("keydown", { key: "Enter" });
  let handled = false;
  editor.view.someProp("handleKeyDown", (handler) => {
    handled = handler(editor.view, event);
    return handled || undefined;
  });
  return handled;
}

describe("TextStyleWithoutSplit", () => {
  it.each(["paragraph", "heading"])(
    "%s의 컬러 텍스트 끝에서 Enter를 누르면 다음 줄은 기본 색으로 입력한다",
    (type) => {
      const editor = new Editor({
        extensions: [StarterKit, TextStyleWithoutSplit, Color],
        content: {
          type: "doc",
          content: [
            {
              type,
              attrs: type === "heading" ? { level: 2 } : undefined,
              content: [
                {
                  type: "text",
                  text: "컬러 텍스트",
                  marks: [{ type: "textStyle", attrs: { color: "#ef4444" } }],
                },
              ],
            },
          ],
        },
      });

      try {
        editor.commands.setTextSelection(editor.state.doc.content.size - 1);
        expect(pressEnter(editor)).toBe(true);
        editor.commands.insertContent("다음 줄");

        const nextText = editor.getJSON().content?.[1]?.content?.[0];
        expect(nextText).toMatchObject({ type: "text", text: "다음 줄" });
        expect(nextText?.marks ?? []).toEqual([]);
      } finally {
        editor.destroy();
      }
    },
  );

  it.each(["paragraph", "heading"])(
    "%s의 블록 컬러 프리셋도 Enter 뒤 새 줄에는 이어지지 않는다",
    (type) => {
      const editor = new Editor({
        extensions: [StarterKit, BlockBackground],
        content: {
          type: "doc",
          content: [
            {
              type,
              attrs: {
                ...(type === "heading" ? { level: 2 } : {}),
                backgroundColor: "blue",
                blockTextColor: "red",
              },
              content: [{ type: "text", text: "컬러 블록" }],
            },
          ],
        },
      });

      try {
        editor.commands.setTextSelection(editor.state.doc.content.size - 1);
        expect(pressEnter(editor)).toBe(true);

        expect(editor.getJSON().content?.[1]?.attrs).toMatchObject({
          backgroundColor: null,
          blockTextColor: null,
        });
      } finally {
        editor.destroy();
      }
    },
  );
});
