import { describe, expect, it } from "vitest";
import { collectFromValue } from "./collect";

const ICON = "asset-" + "a".repeat(64);
const BODY = "asset-" + "b".repeat(64);
const FILE = "asset-" + "c".repeat(64);

function refsOf(value: unknown): Set<string> {
  const out = new Set<string>();
  collectFromValue(value, out);
  return out;
}

describe("collectFromValue", () => {
  it("스킴으로 시작하는 단독 문자열 ref 를 수집한다 (icon/coverImage 필드 형태)", () => {
    expect(refsOf(`quicknote-image://${ICON}`)).toEqual(new Set([ICON]));
    expect(refsOf(`quicknote-file://${FILE}`)).toEqual(new Set([FILE]));
  });

  it("중첩 객체(doc 트리) 내부의 ref 를 수집한다", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "imageBlock", attrs: { src: `quicknote-image://${BODY}` } },
        { type: "paragraph", content: [{ type: "text", text: "무관한 텍스트" }] },
      ],
    };
    expect(refsOf(doc)).toEqual(new Set([BODY]));
  });

  it("JSON 문자열로 직렬화된 doc/snapshot 안의 ref 도 수집한다", () => {
    const snapshot = JSON.stringify({
      doc: { content: [{ attrs: { src: `quicknote-image://${BODY}` } }] },
      dbCells: { colA: `quicknote-file://${FILE}` },
    });
    expect(refsOf(snapshot)).toEqual(new Set([BODY, FILE]));
  });

  it("ref 가 없는 값에서는 아무것도 수집하지 않는다", () => {
    expect(refsOf(null).size).toBe(0);
    expect(refsOf("https://example.com/x.png").size).toBe(0);
    expect(refsOf({ icon: "📄" }).size).toBe(0);
  });
});
