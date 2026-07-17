import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { topLevelInsertionPosFromDrop } from "../blockDropTarget";
import { Toggle, ToggleContent, ToggleHeader } from "../../tiptapExtensions/toggle";

function rect(top: number, bottom: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    bottom,
    left: 0,
    right: 320,
    width: 320,
    height: bottom - top,
    toJSON: () => ({}),
  } as DOMRect;
}

function setRect(el: Element | null, top: number, bottom: number): void {
  if (!(el instanceof HTMLElement)) {
    throw new Error("테스트 DOM 요소를 찾지 못했습니다.");
  }
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () => rect(top, bottom),
  });
}

function createEditor(content: JSONContent): { editor: Editor; host: HTMLElement } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new Editor({
    element: host,
    extensions: [StarterKit, Toggle, ToggleHeader, ToggleContent],
    content,
  });
  return { editor, host };
}

function findPos(editor: Editor, predicate: (nodeName: string, text: string) => boolean): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (predicate(node.type.name, node.textContent)) {
      found = pos;
      return false;
    }
    return true;
  });
  if (found < 0) throw new Error("테스트 위치를 찾지 못했습니다.");
  return found;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("blockDropTarget", () => {
  it("토글 래퍼 위 드롭도 토글 본문 자식 사이 위치로 해석한다", () => {
    const { editor } = createEditor({
      type: "doc",
      content: [
        {
          type: "toggle",
          attrs: { open: true },
          content: [
            {
              type: "toggleHeader",
              attrs: { titleLevel: "2" },
              content: [{ type: "text", text: "제목" }],
            },
            {
              type: "toggleContent",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "첫째" }] },
                { type: "paragraph", content: [{ type: "text", text: "둘째" }] },
              ],
            },
          ],
        },
      ],
    });

    try {
      const togglePos = findPos(editor, (name) => name === "toggle");
      const contentPos = findPos(editor, (name) => name === "toggleContent");
      const firstPos = findPos(editor, (name, text) => name === "paragraph" && text === "첫째");
      const secondPos = findPos(editor, (name, text) => name === "paragraph" && text === "둘째");
      const firstNode = editor.state.doc.nodeAt(firstPos);
      const contentNode = editor.state.doc.nodeAt(contentPos);
      if (!firstNode || !contentNode) throw new Error("테스트 노드를 찾지 못했습니다.");

      const toggleEl = editor.view.nodeDOM(togglePos) as HTMLElement | null;
      const contentEl = editor.view.nodeDOM(contentPos) as HTMLElement | null;
      setRect(toggleEl, 60, 220);
      setRect(contentEl, 90, 210);
      setRect(editor.view.nodeDOM(firstPos) as Element | null, 100, 120);
      setRect(editor.view.nodeDOM(secondPos) as Element | null, 160, 180);

      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: vi.fn(() => toggleEl),
      });
      vi.spyOn(editor.view, "posAtCoords").mockReturnValue({
        pos: secondPos + 1,
        inside: -1,
      });

      const insertAt = topLevelInsertionPosFromDrop(editor.view, 12, 132);

      expect(insertAt).toBe(firstPos + firstNode.nodeSize);
      expect(insertAt).not.toBe(contentPos + contentNode.nodeSize - 1);
    } finally {
      editor.destroy();
    }
  });
});
