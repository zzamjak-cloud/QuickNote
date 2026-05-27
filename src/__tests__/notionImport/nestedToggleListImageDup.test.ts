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
function countType(node: N | unknown, type: string): number {
  if (!node || typeof node !== "object") return 0;
  const rec = node as N;
  let n = rec.type === type ? 1 : 0;
  if (Array.isArray(rec.content)) for (const c of rec.content) n += countType(c, type);
  return n;
}

describe("글머리>토글>글머리>이미지 중첩 중복", () => {
  it("토글/이미지가 다중 복제되지 않는다 (각 1개)", () => {
    const html =
      '<html><body><article class="page">' +
      "<ul><li>상위 항목" +
      "<details open><summary>토글 제목</summary>" +
      '<ul><li>토글 안 항목<figure class="image"><img src="media/x.gif"/></figure></li></ul>' +
      "</details>" +
      "</li></ul>" +
      "</article></body></html>";
    const doc = notionHtmlToDoc(html, {
      resolveImageNode: () => ({ type: "image", attrs: { src: "quicknote-image://x" } }),
    }) as N;
    expect(totalImages(doc)).toBe(1); // 이미지 1개만
    expect(countType(doc, "toggle")).toBe(1); // 토글 1개만
    // top-level 에는 이미지/토글이 직접 노출되지 않고 최상위 bulletList 안에 중첩되어야 한다.
    expect((doc.content ?? []).filter((n) => n.type === "image").length).toBe(0);
    expect((doc.content ?? []).filter((n) => n.type === "toggle").length).toBe(0);
  });
});
