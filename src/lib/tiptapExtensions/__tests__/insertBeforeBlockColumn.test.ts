import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { Column, ColumnLayout } from "../columns";
import { InsertBeforeBlock } from "../insertBeforeBlock";

function createEditor(content: JSONContent): Editor {
  return new Editor({
    extensions: [StarterKit, Column, ColumnLayout, InsertBeforeBlock],
    content,
  });
}

function runAltEnter(editor: Editor): boolean {
  const event = new KeyboardEvent("keydown", { key: "Enter", altKey: true });
  let handled = false;
  editor.view.someProp("handleKeyDown", (handler) => {
    handled = handler(editor.view, event);
    return handled || undefined;
  });
  return handled;
}

describe("insertBeforeBlock — 컬럼 내부 Alt+Enter", () => {
  it("컬럼 안 문단에서 Alt+Enter 시 컬럼 밖이 아니라 컬럼 내부 앞에 빈 문단이 생긴다", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "columnLayout",
          attrs: { columns: 2 },
          content: [
            {
              type: "column",
              content: [{ type: "paragraph", content: [{ type: "text", text: "왼쪽" }] }],
            },
            {
              type: "column",
              content: [{ type: "paragraph", content: [{ type: "text", text: "오른쪽" }] }],
            },
          ],
        },
      ],
    });
    try {
      // 오른쪽 컬럼의 "오른쪽" 문단 안으로 커서 이동.
      const found = { pos: -1 };
      editor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === "오른쪽") found.pos = pos;
      });
      editor.commands.setTextSelection(found.pos + 1);
      expect(runAltEnter(editor)).toBe(true);

      const json = editor.getJSON();
      // 첫 최상위 노드는 여전히 columnLayout (컬럼 밖에 문단이 안 생김).
      expect(json.content?.[0]?.type).toBe("columnLayout");
      // 오른쪽 컬럼 안에 빈 문단이 "오른쪽" 앞에 추가됨.
      const rightCol = json.content?.[0]?.content?.[1];
      expect(rightCol?.content?.length).toBe(2);
      expect(rightCol?.content?.[0]?.content ?? []).toEqual([]);
      expect(rightCol?.content?.[1]?.content?.[0]?.text).toBe("오른쪽");
    } finally {
      editor.destroy();
    }
  });

  it("최상위 문단에서 Alt+Enter 는 기존대로 문서 최상위 앞에 삽입", () => {
    const editor = createEditor({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "본문" }] }],
    });
    try {
      editor.commands.setTextSelection(2);
      expect(runAltEnter(editor)).toBe(true);
      const json = editor.getJSON();
      // "본문" 앞에 빈 문단이 최상위로 삽입됨.
      expect(json.content?.[0]?.content ?? []).toEqual([]);
      expect(json.content?.[1]?.content?.[0]?.text).toBe("본문");
    } finally {
      editor.destroy();
    }
  });
});
