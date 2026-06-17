import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { Callout } from "../callout";

const calloutDoc: JSONContent = {
  type: "doc",
  content: [
    {
      type: "callout",
      attrs: { preset: "idea" },
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "콜아웃 본문" }],
        },
      ],
    },
  ],
};

function createEditor(): Editor {
  return new Editor({
    extensions: [StarterKit, Callout],
    content: calloutDoc,
  });
}

describe("callout spacing", () => {
  it("콜아웃 wrapper가 위아래 margin utility 없이 렌더된다", () => {
    const editor = createEditor();

    try {
      const calloutTag = editor.getHTML().match(/<div[^>]*data-callout[^>]*>/)?.[0];

      expect(calloutTag).toBeTruthy();
      expect(calloutTag).not.toMatch(/\bmy-\d+\b/);
      expect(calloutTag).not.toMatch(/\bmt-\d+\b/);
      expect(calloutTag).not.toMatch(/\bmb-\d+\b/);
    } finally {
      editor.destroy();
    }
  });

  it("에디터 CSS가 콜아웃 wrapper의 위아래 margin을 제거한다", () => {
    const cssPath = join(process.cwd(), "src/index.css");
    const css = readFileSync(cssPath, "utf8");
    const rule = css.match(/\.ProseMirror\s+\[data-callout\]\s*\{(?<body>[^}]*)\}/);
    const body = rule?.groups?.body ?? "";

    expect(body).toContain("margin: 0;");
  });
});
