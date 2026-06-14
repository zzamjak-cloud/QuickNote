import { describe, expect, it } from "vitest";
import { pageDocToMarkdown } from "../../lib/export/pageToMarkdown";
import { notionMarkdownToDoc } from "../../lib/notionImport/markdownToDoc";
import type { JSONContent } from "@tiptap/react";

const sampleTableDoc: JSONContent = {
  type: "doc",
  content: [
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableHeader",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "이름" }] },
              ],
            },
            {
              type: "tableHeader",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "나이" }] },
              ],
            },
          ],
        },
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "철수" }] },
              ],
            },
            {
              type: "tableCell",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "20" }] },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe("pageDocToMarkdown", () => {
  it("표 블록을 GFM 파이프 표로 내보낸다", () => {
    const md = pageDocToMarkdown(sampleTableDoc);
    expect(md).toBe(
      ["| 이름 | 나이 |", "| --- | --- |", "| 철수 | 20 |"].join("\n") + "\n",
    );
  });

  it("내보낸 표 마크다운을 notionMarkdownToDoc으로 table 블록으로 복원한다", () => {
    const md = pageDocToMarkdown(sampleTableDoc).trim();
    const doc = notionMarkdownToDoc(md);
    expect(doc.content?.[0]?.type).toBe("table");
    expect(doc.content?.[0]?.content?.length).toBe(2);
  });

  it("셀 안 파이프 문자를 이스케이프한다", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "식" }],
                    },
                  ],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "a | b" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const md = pageDocToMarkdown(doc).trim();
    expect(md).toContain("a \\| b");
    const parsed = notionMarkdownToDoc(md);
    const cellText =
      parsed.content?.[0]?.content?.[1]?.content?.[0]?.content?.[0]?.content?.[0]
        ?.text;
    expect(cellText).toBe("a | b");
  });
});
