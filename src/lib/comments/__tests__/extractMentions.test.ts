import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/react";
import { extractMentionMemberHitsFromDoc } from "../extractMentions";

describe("extractMentionMemberHitsFromDoc", () => {
  it("멘션이 있는 문단의 미리보기는 해당 문단 텍스트만 담는다(앞 문단과 섞이지 않음)", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "block-prev" },
          content: [{ type: "text", text: "이전 블록 내용입니다" }],
        },
        {
          type: "paragraph",
          attrs: { id: "block-mention" },
          content: [
            {
              type: "mention",
              attrs: { id: "m:member-1", mentionKind: "member" },
            },
            { type: "text", text: " 어떤것 같아요?" },
          ],
        },
      ],
    };
    const hits = extractMentionMemberHitsFromDoc(doc);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.blockId).toBe("block-mention");
    expect(hits[0]!.previewInlineHostText?.trim()).toBe("어떤것 같아요?");
  });

  it("toggleHeader 안의 멘션은 헤더 인라인 전체가 미리보기가 된다", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "toggle",
          attrs: { open: true },
          content: [
            {
              type: "toggleHeader",
              attrs: { id: "th1" },
              content: [
                { type: "text", text: "제목 " },
                {
                  type: "mention",
                  attrs: { id: "m:u2", mentionKind: "member" },
                },
                { type: "text", text: " 확인해줘" },
              ],
            },
            {
              type: "toggleContent",
              content: [{ type: "paragraph", attrs: { id: "p-in" }, content: [] }],
            },
          ],
        },
      ],
    };
    const hits = extractMentionMemberHitsFromDoc(doc);
    expect(hits[0]!.previewInlineHostText?.replace(/\s+/g, " ").trim()).toBe(
      "제목 확인해줘",
    );
  });
});
