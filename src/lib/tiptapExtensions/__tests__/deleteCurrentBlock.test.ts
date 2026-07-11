import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { Callout } from "../callout";
import { DeleteCurrentBlock } from "../deleteCurrentBlock";
import { Toggle, ToggleContent, ToggleHeader } from "../toggle";

function createEditor(content: JSONContent): Editor {
  return new Editor({
    extensions: [
      StarterKit,
      Callout,
      Toggle,
      ToggleHeader,
      ToggleContent,
      DeleteCurrentBlock,
    ],
    content,
  });
}

function runModBackspace(editor: Editor): boolean {
  for (const event of [
    new KeyboardEvent("keydown", { key: "Backspace", metaKey: true }),
    new KeyboardEvent("keydown", { key: "Backspace", ctrlKey: true }),
  ]) {
    let handled = false;
    editor.view.someProp("handleKeyDown", (handler) => {
      handled = handler(editor.view, event);
      return handled || undefined;
    });
    if (handled) return true;
  }
  return false;
}

describe("DeleteCurrentBlock", () => {
  it("콜아웃 안의 단일 글머리 목록 제거 시 콜아웃은 유지한다", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "callout",
          content: [
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "항목" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    try {
      editor.commands.setTextSelection(4);

      expect(runModBackspace(editor)).toBe(true);
      expect(editor.getJSON().content?.[0]?.type).toBe("callout");
      expect(editor.getJSON().content?.[0]?.content?.[0]?.type).toBe("paragraph");
    } finally {
      editor.destroy();
    }
  });

  it("콜아웃 안의 토글 제거 시 콜아웃은 유지한다", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "callout",
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
        },
      ],
    });

    try {
      editor.commands.setTextSelection(3);

      expect(runModBackspace(editor)).toBe(true);
      expect(editor.getJSON().content?.[0]?.type).toBe("callout");
      expect(editor.getJSON().content?.[0]?.content?.[0]?.type).toBe("paragraph");
    } finally {
      editor.destroy();
    }
  });

  it("토글 본문에서 Ctrl+삭제 시 해당 라인만 지우고 토글은 유지한다", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "toggle",
          attrs: { open: true },
          content: [
            { type: "toggleHeader", content: [{ type: "text", text: "제목" }] },
            {
              type: "toggleContent",
              content: [{ type: "paragraph", content: [{ type: "text", text: "본문 라인" }] }],
            },
          ],
        },
      ],
    });

    try {
      // 본문 문단 안쪽에 커서(헤더 "제목" 3자 + 노드 경계들 뒤).
      editor.commands.setTextSelection(9);
      expect(runModBackspace(editor)).toBe(true);
      // 토글은 남아 있고, 본문 라인 내용만 비워진다(토글 전체 삭제 아님).
      const root = editor.getJSON().content?.[0];
      expect(root?.type).toBe("toggle");
      const body = root?.content?.[1];
      expect(body?.type).toBe("toggleContent");
      expect(body?.content?.[0]?.type).toBe("paragraph");
      expect(body?.content?.[0]?.content ?? []).toHaveLength(0);
    } finally {
      editor.destroy();
    }
  });
});
