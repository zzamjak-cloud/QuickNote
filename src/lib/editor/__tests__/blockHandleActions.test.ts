import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import {
  deleteBlockFromHandle,
  deleteListItemNodeSelection,
  toggleBlockBold,
} from "../blockHandleActions";

describe("blockHandleActions", () => {
  it("텍스트 블록 핸들 선택 범위 전체에 굵게를 토글한다", () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "본문" }] }],
      },
    });

    try {
      expect(toggleBlockBold(editor, 0)).toBe(true);
      expect(editor.getJSON().content?.[0]?.content?.[0]?.marks).toEqual([
        { type: "bold" },
      ]);
    } finally {
      editor.destroy();
    }
  });

  it("단독 자식 글머리 항목 삭제 시 빈 행 대신 중첩 목록 컨테이너를 제거한다", () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: {
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "부모" }] },
                  {
                    type: "bulletList",
                    content: [
                      {
                        type: "listItem",
                        content: [
                          { type: "paragraph", content: [{ type: "text", text: "자식" }] },
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

    try {
      let childItemStart = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "listItem" && node.textContent === "자식") {
          childItemStart = pos;
        }
      });

      expect(childItemStart).toBeGreaterThan(0);
      expect(deleteBlockFromHandle(editor, childItemStart)).toBe(true);

      const parentItem = editor.getJSON().content?.[0]?.content?.[0];
      expect(parentItem?.content).toHaveLength(1);
      expect(parentItem?.content?.[0]).toMatchObject({
        type: "paragraph",
        content: [{ type: "text", text: "부모" }],
      });
    } finally {
      editor.destroy();
    }
  });

  it("형제 글머리가 있으면 선택한 항목만 삭제하고 목록은 유지한다", () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: {
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [{ type: "paragraph", content: [{ type: "text", text: "첫째" }] }],
              },
              {
                type: "listItem",
                content: [{ type: "paragraph", content: [{ type: "text", text: "둘째" }] }],
              },
            ],
          },
        ],
      },
    });

    try {
      let secondItemStart = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "listItem" && node.textContent === "둘째") {
          secondItemStart = pos;
        }
      });

      expect(deleteBlockFromHandle(editor, secondItemStart)).toBe(true);
      const list = editor.getJSON().content?.[0];
      expect(list?.type).toBe("bulletList");
      expect(list?.content).toHaveLength(1);
      expect(list?.content?.[0]?.textContent).toBeUndefined();
      expect(list?.content?.[0]?.content?.[0]?.content?.[0]?.text).toBe("첫째");
    } finally {
      editor.destroy();
    }
  });

  it("NodeSelection 삭제 경로도 단독 자식 목록 컨테이너를 제거한다", () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: {
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "부모" }] },
                  {
                    type: "bulletList",
                    content: [
                      {
                        type: "listItem",
                        content: [
                          { type: "paragraph", content: [{ type: "text", text: "자식" }] },
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

    try {
      let childItemStart = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "listItem" && node.textContent === "자식") {
          childItemStart = pos;
        }
      });

      expect(deleteListItemNodeSelection(editor, childItemStart)).toBe(true);
      expect(editor.state.doc.textContent).toBe("부모");
      expect(editor.getJSON().content?.[0]?.content?.[0]?.content).toHaveLength(1);
    } finally {
      editor.destroy();
    }
  });

  it("목록 내부의 자식 블록 NodeSelection은 행 삭제로 오인하지 않는다", () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: {
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "항목" }] },
                  { type: "horizontalRule" },
                ],
              },
            ],
          },
        ],
      },
    });

    try {
      let ruleStart = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "horizontalRule") ruleStart = pos;
      });

      expect(deleteListItemNodeSelection(editor, ruleStart)).toBe(false);
      expect(editor.getJSON().content?.[0]?.content?.[0]?.content?.[1]?.type).toBe(
        "horizontalRule",
      );

      expect(deleteBlockFromHandle(editor, ruleStart)).toBe(true);
      expect(editor.state.doc.textContent).toBe("항목");
      expect(editor.getJSON().content?.[0]?.content?.[0]?.content).toHaveLength(1);
    } finally {
      editor.destroy();
    }
  });
});
