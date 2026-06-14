import { describe, expect, it } from "vitest";
import {
  buildQuickNotePageUrl,
  parseQuickNoteLink,
} from "../quicknoteLinks";

describe("quicknoteLinks text 파라미터", () => {
  it("build→parse 라운드트립으로 text 가 보존된다", () => {
    const url = buildQuickNotePageUrl({ pageId: "p1", text: "스택 오버플로" });
    const parsed = parseQuickNoteLink(url);
    expect(parsed?.pageId).toBe("p1");
    expect(parsed?.text).toBe("스택 오버플로");
  });

  it("공백·특수문자가 포함된 text 도 인코딩/디코딩된다", () => {
    const label = "API & 콜백 (비동기)";
    const url = buildQuickNotePageUrl({ pageId: "abc", text: label });
    const parsed = parseQuickNoteLink(url);
    expect(parsed?.text).toBe(label);
  });

  it("text 가 없으면 URL 에 text 쿼리를 넣지 않고 parse 결과도 null 이다", () => {
    const url = buildQuickNotePageUrl({ pageId: "p2" });
    expect(url.includes("text=")).toBe(false);
    const parsed = parseQuickNoteLink(url);
    expect(parsed?.text).toBeNull();
  });

  it("quicknote://page/ 형식도 text 파라미터를 디코드한다", () => {
    const parsed = parseQuickNoteLink(
      "quicknote://page/pageX?text=" + encodeURIComponent("용어명"),
    );
    expect(parsed?.pageId).toBe("pageX");
    expect(parsed?.text).toBe("용어명");
  });
});
