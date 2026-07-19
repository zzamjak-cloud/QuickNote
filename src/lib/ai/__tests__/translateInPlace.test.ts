import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import { ButtonBlock } from "../../tiptapExtensions/buttonBlock";
import {
  applyTranslationTargets,
  collectTranslationTargets,
} from "../translateInPlace";

function buttonDoc(): JSONContent {
  return {
    type: "doc",
    content: [{
      type: "paragraph",
      content: [
        {
          type: "buttonBlock",
          attrs: {
            label: "지금 다운로드",
            href: "https://example.com/download",
            databaseId: "",
            color: "purple",
          },
        },
        {
          type: "buttonBlock",
          attrs: {
            label: "제품 DB",
            href: "",
            databaseId: "database-1",
            color: "blue",
          },
        },
      ],
    }],
  };
}

describe("페이지 제자리 번역", () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  it("일반 버튼 라벨을 수집하고 DB 전용 버튼은 제외한다", () => {
    editor = new Editor({ extensions: [StarterKit, ButtonBlock], content: buttonDoc() });

    const targets = collectTranslationTargets(editor);

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      kind: "attribute",
      attribute: "label",
      text: "지금 다운로드",
    });
  });

  it("버튼의 링크·DB 연결·색상을 유지하고 라벨만 번역한다", () => {
    editor = new Editor({ extensions: [StarterKit, ButtonBlock], content: buttonDoc() });
    const targets = collectTranslationTargets(editor);

    expect(applyTranslationTargets(editor, targets, ["Download now"])).toBe(1);

    const buttons = editor.getJSON().content?.[0]?.content ?? [];
    expect(buttons[0]?.attrs).toMatchObject({
      label: "Download now",
      href: "https://example.com/download",
      databaseId: "",
      color: "purple",
    });
    expect(buttons[1]?.attrs).toMatchObject({
      label: "제품 DB",
      href: "",
      databaseId: "database-1",
      color: "blue",
    });
  });
});
