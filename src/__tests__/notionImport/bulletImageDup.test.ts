import { describe, expect, it } from "vitest";
import { notionHtmlToDoc } from "../../lib/notionImport/htmlToDoc";

type N = { type?: string; content?: N[] };

function totalImages(node: N | unknown): number {
  if (!node || typeof node !== "object") return 0;
  const rec = node as N;
  let n = rec.type === "image" ? 1 : 0;
  if (Array.isArray(rec.content)) for (const c of rec.content) n += totalImages(c);
  return n;
}
function topLevelImages(doc: N): number {
  return (doc.content ?? []).filter((n) => n.type === "image").length;
}
function imagesInsideLists(doc: N): number {
  let n = 0;
  for (const b of doc.content ?? []) {
    if (b.type !== "bulletList" && b.type !== "orderedList") continue;
    for (const li of b.content ?? []) for (const c of li.content ?? []) if (c.type === "image") n += 1;
  }
  return n;
}

describe("글머리(li) 내부 이미지 중복", () => {
  it("li 안 figure 이미지: 중복 없이 리스트 내부에만 유지", () => {
    const html =
      '<html><body><article class="page">' +
      '<ul><li>항목<figure class="image"><img src="media/a.png"/></figure></li></ul>' +
      "</article></body></html>";
    const doc = notionHtmlToDoc(html, {
      resolveImageNode: () => ({ type: "image", attrs: { src: "quicknote-image://a" } }),
    }) as N;
    expect(totalImages(doc)).toBe(1);
    expect(imagesInsideLists(doc)).toBe(1); // 리스트 내부 유지
    expect(topLevelImages(doc)).toBe(0); // 바깥 중복 제거
  });

  it("li 안 bare img: 중복 없이 리스트 내부에만 유지", () => {
    const html =
      '<html><body><article class="page">' +
      '<ul><li>항목<img src="media/b.png"/></li></ul>' +
      "</article></body></html>";
    const doc = notionHtmlToDoc(html, {
      resolveImageNode: () => ({ type: "image", attrs: { src: "quicknote-image://b" } }),
    }) as N;
    expect(totalImages(doc)).toBe(1);
    expect(imagesInsideLists(doc)).toBe(1);
    expect(topLevelImages(doc)).toBe(0);
  });
});
