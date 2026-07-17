import { describe, expect, it } from "vitest";
import { extractOutlineFromDocJson } from "../pageOutline";

describe("extractOutlineFromDocJson", () => {
  it("헤딩과 제목 토글을 같은 문서 순서로 목차에 포함한다", () => {
    const outline = extractOutlineFromDocJson({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "문서 제목" }],
        },
        {
          type: "toggle",
          attrs: { open: true },
          content: [
            {
              type: "toggleHeader",
              attrs: { titleLevel: "2" },
              content: [{ type: "text", text: "접히는 섹션" }],
            },
            {
              type: "toggleContent",
              content: [
                {
                  type: "heading",
                  attrs: { level: 3 },
                  content: [{ type: "text", text: "내부 헤딩" }],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(outline).toEqual([
      { kind: "heading", level: 1, text: "문서 제목" },
      { kind: "toggle", level: 2, text: "접히는 섹션" },
      { kind: "heading", level: 3, text: "내부 헤딩" },
    ]);
  });

  it("일반 토글 제목은 목차에 포함하지 않는다", () => {
    const outline = extractOutlineFromDocJson({
      type: "doc",
      content: [
        {
          type: "toggle",
          attrs: { open: true },
          content: [
            {
              type: "toggleHeader",
              attrs: { titleLevel: null },
              content: [{ type: "text", text: "일반 토글" }],
            },
            {
              type: "toggleContent",
              content: [{ type: "paragraph" }],
            },
          ],
        },
      ],
    });

    expect(outline).toEqual([]);
  });
});
