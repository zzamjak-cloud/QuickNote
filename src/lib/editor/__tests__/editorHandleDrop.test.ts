import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditorHandleDrop } from "../editorHandleDrop";
import type { insertImageFromFile } from "../insertImageFromFile";
import { QUICKNOTE_BLOCK_DRAG_MIME } from "../../startBlockNativeDrag";
import { ListItemPermissive } from "../../tiptapExtensions/listItemPermissive";

function createListEditor(): Editor {
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
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "부모" }],
                },
                {
                  type: "bulletList",
                  content: [
                    {
                      type: "listItem",
                      content: [
                        {
                          type: "paragraph",
                          content: [{ type: "text", text: "B" }],
                        },
                      ],
                    },
                    {
                      type: "listItem",
                      content: [
                        {
                          type: "paragraph",
                          content: [{ type: "text", text: "C" }],
                        },
                      ],
                    },
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

function listItemStartByText(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "listItem" && node.textContent === text) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}

function parentTextPos(editor: Editor): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === "부모") {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}

function nestedChildTexts(editor: Editor): string[] {
  let texts: string[] = [];
  editor.state.doc.descendants((node) => {
    if (
      node.type.name !== "listItem" ||
      !node.textContent.startsWith("부모")
    ) {
      return true;
    }
    const nestedList = node.content.content.find(
      (child) => child.type.name === "bulletList",
    );
    texts = nestedList?.content.content.map((child) => child.textContent) ?? [];
    return false;
  });
  return texts;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createEditorHandleDrop", () => {
  it("자식 글머리 항목을 같은 중첩 목록의 형제 뒤로 드래그 이동한다", () => {
    const editor = createListEditor();
    try {
      document.body.appendChild(editor.view.dom);
      const draggedStart = listItemStartByText(editor, "B");
      const targetStart = listItemStartByText(editor, "C");
      expect(draggedStart).toBeGreaterThan(0);
      expect(targetStart).toBeGreaterThan(0);

      const targetEl = editor.view.nodeDOM(targetStart);
      expect(targetEl).toBeInstanceOf(HTMLElement);
      const targetLi = targetEl as HTMLElement;
      vi.spyOn(targetLi, "getBoundingClientRect").mockReturnValue({
        top: 10,
        bottom: 30,
        left: 40,
        right: 240,
        width: 200,
        height: 20,
        x: 40,
        y: 10,
        toJSON: () => ({}),
      });
      Object.defineProperty(document, "elementsFromPoint", {
        configurable: true,
        value: vi.fn(() => [targetLi]),
      });
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: vi.fn(() => targetLi),
      });
      vi.spyOn(editor.view, "posAtCoords").mockReturnValue({
        pos: parentTextPos(editor),
        inside: -1,
      });

      const preventDefault = vi.fn();
      const event = {
        clientX: 42,
        clientY: 24,
        dataTransfer: {
          getData: (type: string) =>
            type === QUICKNOTE_BLOCK_DRAG_MIME
              ? JSON.stringify([draggedStart])
              : "",
          files: [],
          types: [QUICKNOTE_BLOCK_DRAG_MIME],
        },
        preventDefault,
      } as unknown as DragEvent;
      const handleDrop = createEditorHandleDrop({
        columnDropRef: { current: null },
        clearColumnDropUi: vi.fn(),
        clearBlockDropIndicator: vi.fn(),
        insertImageFromFile: vi.fn() as unknown as typeof insertImageFromFile,
      });

      expect(handleDrop(editor.view, event, null, false)).toBe(true);
      expect(preventDefault).toHaveBeenCalled();
      expect(nestedChildTexts(editor)).toEqual(["C", "B"]);
    } finally {
      editor.destroy();
    }
  });
});
