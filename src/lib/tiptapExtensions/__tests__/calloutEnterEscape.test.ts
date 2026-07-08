import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { Callout } from "../callout";

function createEditor(content: JSONContent): Editor {
  return new Editor({ extensions: [StarterKit, Callout], content });
}

function runEnter(editor: Editor): boolean {
  const event = new KeyboardEvent("keydown", { key: "Enter" });
  let handled = false;
  editor.view.someProp("handleKeyDown", (handler) => {
    handled = handler(editor.view, event);
    return handled || undefined;
  });
  return handled;
}

// 콜아웃 노드 안에서 마지막 자식(빈 문단) 시작 위치를 찾아 커서를 놓는다.
function selectInsideCalloutLastChild(editor: Editor): void {
  let calloutPos = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "callout") calloutPos = pos;
  });
  const callout = editor.state.doc.nodeAt(calloutPos);
  if (!callout) throw new Error("callout not found");
  // 콜아웃 마지막 자식 문단 내부(+1) 로 커서 이동.
  const lastChildStart = calloutPos + callout.nodeSize - 1 - (callout.lastChild?.nodeSize ?? 2);
  editor.commands.setTextSelection(lastChildStart + 1);
}

describe("Callout Enter 탈출", () => {
  it("마지막 빈 문단에서 Enter → 콜아웃 밖에 빈 문단이 생기고 콜아웃 자식은 줄어든다", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "callout",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "내용" }] },
            { type: "paragraph" },
          ],
        },
      ],
    });
    try {
      selectInsideCalloutLastChild(editor);
      expect(runEnter(editor)).toBe(true);
      const json = editor.getJSON();
      // 콜아웃 유지 + 자식 1개로 감소(빈 문단이 밖으로 이동).
      expect(json.content?.[0]?.type).toBe("callout");
      expect(json.content?.[0]?.content?.length).toBe(1);
      // 콜아웃 바로 다음이 빈 문단.
      expect(json.content?.[1]?.type).toBe("paragraph");
      expect(json.content?.[1]?.content ?? []).toEqual([]);
      // 커서가 그 새 문단으로 이동.
      expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
    } finally {
      editor.destroy();
    }
  });

  it("내용이 있는 문단에서 Enter 는 콜아웃을 벗어나지 않는다", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "callout",
          content: [{ type: "paragraph", content: [{ type: "text", text: "내용" }] }],
        },
      ],
    });
    try {
      let calloutPos = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "callout") calloutPos = pos;
      });
      // "내용" 끝(pos = calloutPos + 1 + 문단여는1 + 2글자)
      editor.commands.setTextSelection(calloutPos + 4);
      const before = editor.getJSON().content?.[0];
      runEnter(editor);
      const after = editor.getJSON();
      // 첫 노드는 여전히 콜아웃(탈출 안 함) — 기본 Enter 는 콜아웃 내부에서 문단만 분할.
      expect(after.content?.[0]?.type).toBe("callout");
      expect(before?.type).toBe("callout");
    } finally {
      editor.destroy();
    }
  });
});
