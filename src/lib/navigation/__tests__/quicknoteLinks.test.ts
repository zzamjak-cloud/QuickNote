import { describe, expect, it } from "vitest";
import {
  buildQuickNotePageUrl,
  parseQuickNoteLink,
} from "../quicknoteLinks";

describe("quicknoteLinks blockId 파라미터", () => {
  it("build→parse 라운드트립으로 blockId 가 보존된다", () => {
    const url = buildQuickNotePageUrl({ pageId: "p1", blockId: "hid-1" });
    const parsed = parseQuickNoteLink(url);
    expect(parsed?.pageId).toBe("p1");
    expect(parsed?.blockId).toBe("hid-1");
  });

  it("blockId 가 없으면 URL 에 blockId 쿼리를 넣지 않는다", () => {
    const url = buildQuickNotePageUrl({ pageId: "p2" });
    expect(url.includes("blockId=")).toBe(false);
    const parsed = parseQuickNoteLink(url);
    expect(parsed?.blockId).toBeNull();
  });

  it("quicknote://page/ 형식도 blockId 파라미터를 파싱한다", () => {
    const parsed = parseQuickNoteLink(
      "quicknote://page/pageX?blockId=" + encodeURIComponent("uuid-123"),
    );
    expect(parsed?.pageId).toBe("pageX");
    expect(parsed?.blockId).toBe("uuid-123");
  });
});
