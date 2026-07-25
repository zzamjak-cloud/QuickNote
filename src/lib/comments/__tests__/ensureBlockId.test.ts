import { Editor } from "@tiptap/core";
import UniqueID from "@tiptap/extension-unique-id";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import {
  ensureCommentAnchorBlockId,
  findBlockStartsById,
} from "../ensureBlockId";

function createEditor() {
  return new Editor({
    extensions: [
      StarterKit,
      UniqueID.configure({
        types: ["paragraph"],
        updateDocument: false,
      }),
    ],
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "dup" },
          content: [{ type: "text", text: "첫 번째" }],
        },
        {
          type: "paragraph",
          attrs: { id: "dup" },
          content: [{ type: "text", text: "두 번째" }],
        },
      ],
    },
  });
}

describe("ensureCommentAnchorBlockId", () => {
  it("중복 id 의 후순위 블럭은 새 id 로 분리한다", () => {
    const editor = createEditor();
    try {
      const secondStart = findBlockStartsById(editor, "dup")[1];
      expect(secondStart).toBeGreaterThan(0);

      const nextId = ensureCommentAnchorBlockId(editor, secondStart);

      expect(nextId).toBeTruthy();
      expect(nextId).not.toBe("dup");
      expect(findBlockStartsById(editor, "dup")).toHaveLength(1);
      expect(findBlockStartsById(editor, nextId ?? "")).toEqual([secondStart]);
    } finally {
      editor.destroy();
    }
  });

  it("중복 id 의 첫 번째 블럭은 기존 댓글 호환을 위해 id 를 유지한다", () => {
    const editor = createEditor();
    try {
      const firstStart = findBlockStartsById(editor, "dup")[0];
      expect(firstStart).toBe(0);

      const nextId = ensureCommentAnchorBlockId(editor, firstStart);

      expect(nextId).toBe("dup");
      expect(findBlockStartsById(editor, "dup")).toHaveLength(2);
    } finally {
      editor.destroy();
    }
  });
});
