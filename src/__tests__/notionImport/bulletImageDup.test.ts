import { describe, expect, it } from "vitest";
import { notionHtmlToDoc } from "../../lib/notionImport/htmlToDoc";

function countImages(node: unknown): number {
  if (!node || typeof node !== "object") return 0;
  const rec = node as { type?: string; content?: unknown[] };
  let n = rec.type === "image" ? 1 : 0;
  if (Array.isArray(rec.content)) for (const c of rec.content) n += countImages(c);
  return n;
}

describe("글머리(li) 내부 이미지 중복", () => {
  it("li 안의 figure 이미지가 리스트 안/밖으로 2번 생성되지 않는다", () => {
    const html =
      '<html><body><article class="page">' +
      '<ul><li>항목<figure class="image"><img src="media/a.png"/></figure></li></ul>' +
      "</article></body></html>";
    const doc = notionHtmlToDoc(html, {
      resolveImageNode: () => ({ type: "image", attrs: { src: "quicknote-image://a" } }),
    });
    expect(countImages(doc)).toBe(1);
  });

  it("li 안의 bare img 도 1번만 생성된다", () => {
    const html =
      '<html><body><article class="page">' +
      '<ul><li>항목<img src="media/b.png"/></li></ul>' +
      "</article></body></html>";
    const doc = notionHtmlToDoc(html, {
      resolveImageNode: () => ({ type: "image", attrs: { src: "quicknote-image://b" } }),
    });
    expect(countImages(doc)).toBe(1);
  });
});
