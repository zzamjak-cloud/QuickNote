import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { ListItemPermissive } from "../listItemPermissive";

function createEditor() {
  return new Editor({
    extensions: [
      StarterKit.configure({ orderedList: false, listItem: false }),
      ListItemPermissive,
    ],
    content: {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] },
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Parent" }] },
                {
                  type: "bulletList",
                  content: [
                    { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "B" }] }] },
                    { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "C" }] }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  });
}

function posOf(editor: Editor, text: string): number {
  let p = -1;
  editor.state.doc.descendants((n, pp) => {
    if (n.isText && n.text === text) p = pp;
  });
  return p;
}

/** listItem 첫 자식이 리스트인(=이중 마커) 항목 수. */
function nestedListFirstChildCount(editor: Editor): number {
  let n = 0;
  editor.state.doc.descendants((node) => {
    if (
      (node.type.name === "listItem" || node.type.name === "taskItem") &&
      node.firstChild &&
      ["bulletList", "orderedList", "taskList"].includes(node.firstChild.type.name)
    ) {
      n += 1;
    }
  });
  return n;
}

describe("ListItemPermissive 중첩 리스트 이중 마커 정규화", () => {
  it("범위 선택 삭제로 <li><ul> 가 생겨도 leading 빈 문단으로 보정된다", () => {
    const editor = createEditor();
    try {
      // "A" 시작 ~ "B" 시작 범위 선택 후 Backspace 합성.
      editor.commands.setTextSelection({ from: posOf(editor, "A"), to: posOf(editor, "B") });
      const ev = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
      editor.view.someProp("handleKeyDown", (f) => f(editor.view, ev));

      // 정규화 appendTransaction 이후 첫 자식이 리스트인 항목은 0 이어야 한다.
      expect(nestedListFirstChildCount(editor)).toBe(0);
    } finally {
      editor.destroy();
    }
  });

  it("정상 중첩(<li><p>텍스트</p><ul>)은 그대로 유지된다", () => {
    const editor = createEditor();
    try {
      // 아무 편집 없이도 정규화가 정상 구조를 건드리지 않아야 한다(초기 문서에 트랜잭션 유발).
      editor.commands.insertContentAt(posOf(editor, "C") + 1, "!");
      expect(nestedListFirstChildCount(editor)).toBe(0);
      // "Parent" 문단이 여전히 두 번째 listItem 의 첫 자식.
      const json = editor.getJSON();
      const parentLi = json.content?.[0]?.content?.[1];
      expect(parentLi?.content?.[0]?.type).toBe("paragraph");
      expect(parentLi?.content?.[0]?.content?.[0]?.text).toBe("Parent");
    } finally {
      editor.destroy();
    }
  });
});
