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
function imagesInsideCallouts(doc: N): number {
  let n = 0;
  for (const b of doc.content ?? []) {
    if (b.type !== "callout") continue;
    n += totalImages(b);
  }
  return n;
}

const resolveImg = () => ({ type: "image", attrs: { src: "quicknote-image://x" } });

describe("콜아웃 내부 이미지 중복", () => {
  it("figure.callout 안 figure 이미지: 콜아웃 내부에만 유지", () => {
    const html =
      '<html><body><article class="page">' +
      '<figure class="callout"><div><p>설명</p><figure class="image"><img src="media/a.png"/></figure></div></figure>' +
      "</article></body></html>";
    const doc = notionHtmlToDoc(html, { resolveImageNode: resolveImg }) as N;
    expect(totalImages(doc)).toBe(1);
    expect(imagesInsideCallouts(doc)).toBe(1);
    expect(topLevelImages(doc)).toBe(0);
  });

  it("aside 콜아웃 안 이미지: 콜아웃 내부에만 유지", () => {
    const html =
      '<html><body><article class="page">' +
      '<aside><p>노트</p><figure class="image"><img src="media/b.png"/></figure></aside>' +
      "</article></body></html>";
    const doc = notionHtmlToDoc(html, { resolveImageNode: resolveImg }) as N;
    expect(totalImages(doc)).toBe(1);
    expect(topLevelImages(doc)).toBe(0);
  });
});
