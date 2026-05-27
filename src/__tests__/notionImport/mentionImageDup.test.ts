import { describe, expect, it } from "vitest";
import { notionHtmlToDoc } from "../../lib/notionImport/htmlToDoc";

const resolvePM = (href: string) =>
  href.includes("aaaa1111") ? { pageId: "page-a", label: "자식 A" } : null;

function flat(doc: ReturnType<typeof notionHtmlToDoc>) {
  return (doc.content ?? []).map((n) => {
    if (n.type === "paragraph" && n.content?.[0]?.type === "mention") return "mention";
    return n.type;
  });
}

describe("link-to-page 멘션/이미지 중복", () => {
  it("최상위 link-to-page figure(아이콘 img 포함) → 멘션 1개만, 이미지 없음", () => {
    const html =
      '<html><body><article class="page">' +
      '<figure class="link-to-page"><a href="Child%20aaaa1111.html"><img class="icon" src="https://www.notion.so/icons/x.svg"/>자식 A</a></figure>' +
      "</article></body></html>";
    const doc = notionHtmlToDoc(html, { resolveImageSrc: () => null, resolvePageMentionByHref: resolvePM });
    const types = flat(doc);
    expect(types.filter((t) => t === "mention").length).toBe(1);
    expect(types.filter((t) => t === "image").length).toBe(0);
  });

  it("link-to-page 가 figure 가 아니라 a 안에 figure(이미지)와 멘션이 함께 — 중복 금지", () => {
    // Notion 변형: link-to-page figure 가 본문 이미지 figure 와 인접
    const html =
      '<html><body><article class="page">' +
      '<figure class="link-to-page"><a href="Child%20aaaa1111.html"><img class="icon" src="x.svg"/>자식 A</a></figure>' +
      '<figure class="link-to-page"><a href="Child%20aaaa1111.html"><img class="icon" src="x.svg"/>자식 A</a></figure>' +
      "</article></body></html>";
    const doc = notionHtmlToDoc(html, { resolveImageSrc: () => null, resolvePageMentionByHref: resolvePM });
    const types = flat(doc);
    // 동일 멘션 연속 2개 → dedupe 로 1개
    expect(types.filter((t) => t === "mention").length).toBe(1);
  });

  it("멘션 해소 실패 시 아이콘 이미지가 본문 이미지로 남지 않아야 한다(아이콘 제외)", () => {
    const html =
      '<html><body><article class="page">' +
      '<figure class="link-to-page"><a href="Child%20bbbb2222.html"><img class="icon notion-static-icon" src="https://www.notion.so/icons/x.svg"/>자식 B</a></figure>' +
      "</article></body></html>";
    const doc = notionHtmlToDoc(html, { resolveImageSrc: () => null, resolvePageMentionByHref: resolvePM });
    const types = flat(doc);
    expect(types.filter((t) => t === "image").length).toBe(0);
  });
});
