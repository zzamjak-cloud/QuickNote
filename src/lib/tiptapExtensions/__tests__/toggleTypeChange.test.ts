import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { Toggle, ToggleContent, ToggleHeader } from "../toggle";

function createEditor(content: string): Editor {
  return new Editor({
    extensions: [StarterKit, Toggle, ToggleHeader, ToggleContent],
    content,
  });
}

describe("toggle type change", () => {
  it("새 토글은 제목 텍스트를 실제 content로 넣지 않는다", () => {
    const editor = createEditor("<p></p>");

    try {
      editor.commands.setTextSelection(1);
      editor.commands.setToggle();

      const toggle = editor.getJSON().content?.[0];
      const header = toggle?.content?.[0];

      expect(toggle?.type).toBe("toggle");
      expect(header?.type).toBe("toggleHeader");
      expect(header?.content).toBeUndefined();
      expect(editor.getText()).not.toContain("토글 제목");
      expect(editor.getHTML()).toContain('data-title-empty="true"');
    } finally {
      editor.destroy();
    }
  });

  it("새 제목 토글도 제목 텍스트를 실제 content로 넣지 않는다", () => {
    const editor = createEditor("<p></p>");

    try {
      editor.commands.setTextSelection(1);
      editor.commands.setHeadingToggle(1);

      const toggle = editor.getJSON().content?.[0];
      const header = toggle?.content?.[0];

      expect(toggle?.type).toBe("toggle");
      expect(header).toMatchObject({
        type: "toggleHeader",
        attrs: { titleLevel: "1" },
      });
      expect(header?.content).toBeUndefined();
      expect(editor.getText()).not.toContain("제목 1 토글");
    } finally {
      editor.destroy();
    }
  });

  it("글머리 목록을 토글로 바꿀 때 첫 항목 텍스트를 제목으로 유지한다", () => {
    const editor = createEditor("<ul><li><p>보존할 제목</p></li></ul>");

    try {
      editor.commands.setNodeSelection(0);
      editor.commands.setToggle();

      const toggle = editor.getJSON().content?.[0];
      const header = toggle?.content?.[0];

      expect(toggle?.type).toBe("toggle");
      expect(header).toMatchObject({
        type: "toggleHeader",
        content: [{ type: "text", text: "보존할 제목" }],
      });
    } finally {
      editor.destroy();
    }
  });

  it("글머리 항목을 직접 토글로 바꿔도 항목 텍스트를 제목으로 유지한다", () => {
    const editor = createEditor("<ul><li><p>항목 제목</p></li></ul>");

    try {
      editor.commands.setNodeSelection(1);
      editor.commands.setToggle();

      const toggle = editor.getJSON().content?.[0];
      const header = toggle?.content?.[0];

      expect(toggle?.type).toBe("toggle");
      expect(header).toMatchObject({
        type: "toggleHeader",
        content: [{ type: "text", text: "항목 제목" }],
      });
    } finally {
      editor.destroy();
    }
  });
});
