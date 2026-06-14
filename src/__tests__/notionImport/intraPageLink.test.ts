import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/react";
import { notionHtmlToDoc } from "../../lib/notionImport/htmlToDoc";
import { parseQuickNoteLink } from "../../lib/navigation/quicknoteLinks";

/** 문서 트리에서 첫 번째 link 마크가 달린 텍스트 노드를 찾는다. */
function findLinkTextNode(doc: JSONContent): JSONContent | null {
  let found: JSONContent | null = null;
  const walk = (node: JSONContent) => {
    if (found) return;
    if (
      node.type === "text" &&
      (node.marks ?? []).some((m) => m.type === "link")
    ) {
      found = node;
      return;
    }
    for (const child of node.content ?? []) walk(child);
  };
  for (const child of doc.content ?? []) walk(child);
  return found;
}

/** 문서 트리에서 link 마크가 달린 모든 텍스트 노드를 모은다. */
function collectLinkTextNodes(doc: JSONContent): JSONContent[] {
  const out: JSONContent[] = [];
  const walk = (node: JSONContent) => {
    if (
      node.type === "text" &&
      (node.marks ?? []).some((m) => m.type === "link")
    ) {
      out.push(node);
    }
    for (const child of node.content ?? []) walk(child);
  };
  for (const child of doc.content ?? []) walk(child);
  return out;
}

/** 문서 트리에서 type 이 heading 인 노드를 모두 모은다. */
function collectHeadings(doc: JSONContent): JSONContent[] {
  return (doc.content ?? []).filter((n) => n.type === "heading");
}

/** 문서 트리에서 page mention 노드를 찾는다. */
function findMention(doc: JSONContent): JSONContent | null {
  let found: JSONContent | null = null;
  const walk = (node: JSONContent) => {
    if (found) return;
    if (node.type === "mention") {
      found = node;
      return;
    }
    for (const child of node.content ?? []) walk(child);
  };
  for (const child of doc.content ?? []) walk(child);
  return found;
}

describe("notionHtmlToDoc 자기참조 블록 링크", () => {
  it("라벨↔제목 유일 매칭 시 blockId 링크로 변환되고 라벨·heading id 가 보존된다", () => {
    const html = [
      "<html><body><article class=\"page\">",
      "<h3 id=\"hid-1\">Stickness Ratio</h3>",
      "<p>자세한 내용은 <a href=\"self.html\">Stickness Ratio</a>를 참조하세요.</p>",
      "</article></body></html>",
    ].join("");
    const doc = notionHtmlToDoc(html, {
      resolvePageMentionByHref: () => ({ pageId: "page-self", label: "현재 페이지 제목", intraPage: true }),
    });

    expect(findMention(doc)).toBeNull();

    const linkNode = findLinkTextNode(doc);
    expect(linkNode?.text).toBe("Stickness Ratio");
    const linkMark = (linkNode?.marks ?? []).find((m) => m.type === "link");
    const target = parseQuickNoteLink(String(linkMark?.attrs?.href ?? ""));
    expect(target?.pageId).toBe("page-self");
    expect(target?.blockId).toBe("hid-1");

    // heading 노드에 노션 uuid 가 attrs.id 로 보존된다.
    const heading = collectHeadings(doc).find((h) => h.attrs?.id === "hid-1");
    expect(heading).toBeTruthy();
  });

  it("선두 화살표/대소문자 차이를 정규화해 매칭한다", () => {
    const html = [
      "<html><body><article class=\"page\">",
      "<p>맨 위로 <a href=\"self.html\">↑색인</a></p>",
      "<h3 id=\"idx\">색인</h3>",
      "</article></body></html>",
    ].join("");
    const doc = notionHtmlToDoc(html, {
      resolvePageMentionByHref: () => ({ pageId: "page-self", intraPage: true }),
    });
    const linkNode = findLinkTextNode(doc);
    expect(linkNode?.text).toBe("↑색인");
    const linkMark = (linkNode?.marks ?? []).find((m) => m.type === "link");
    const target = parseQuickNoteLink(String(linkMark?.attrs?.href ?? ""));
    expect(target?.blockId).toBe("idx");
  });

  it("어떤 heading 과도 매칭 안 되면 링크 없이 라벨만 보존한다", () => {
    const html = [
      "<html><body><article class=\"page\">",
      "<h3 id=\"hid-1\">색인</h3>",
      "<p><a href=\"self.html\">존재하지 않는 용어</a></p>",
      "</article></body></html>",
    ].join("");
    const doc = notionHtmlToDoc(html, {
      resolvePageMentionByHref: () => ({ pageId: "page-self", intraPage: true }),
    });
    expect(findMention(doc)).toBeNull();
    expect(findLinkTextNode(doc)).toBeNull();
    // 라벨 텍스트 자체는 본문에 남아 있어야 한다.
    const allText = JSON.stringify(doc);
    expect(allText).toContain("존재하지 않는 용어");
  });

  it("같은 제목 heading 이 2개면(모호) 링크 없이 라벨만 보존한다", () => {
    const html = [
      "<html><body><article class=\"page\">",
      "<h3 id=\"a\">개요</h3>",
      "<h3 id=\"b\">개요</h3>",
      "<p><a href=\"self.html\">개요</a></p>",
      "</article></body></html>",
    ].join("");
    const doc = notionHtmlToDoc(html, {
      resolvePageMentionByHref: () => ({ pageId: "page-self", intraPage: true }),
    });
    expect(findLinkTextNode(doc)).toBeNull();
  });

  it("한 문단의 여러 자기참조 링크가 각각 개별 보존된다", () => {
    const html = [
      "<html><body><article class=\"page\">",
      "<h3 id=\"h-a\">알파</h3>",
      "<h3 id=\"h-b\">베타</h3>",
      "<p><a href=\"self.html\">알파</a> 그리고 <a href=\"self.html\">베타</a> 그리고 <a href=\"self.html\">감마</a></p>",
      "</article></body></html>",
    ].join("");
    const doc = notionHtmlToDoc(html, {
      resolvePageMentionByHref: () => ({ pageId: "page-self", intraPage: true }),
    });
    const links = collectLinkTextNodes(doc);
    // 알파·베타는 매칭되어 링크 2개, 감마는 미매칭(텍스트만).
    expect(links.length).toBe(2);
    const blockIds = links
      .map((n) => parseQuickNoteLink(String((n.marks ?? []).find((m) => m.type === "link")?.attrs?.href ?? ""))?.blockId)
      .sort();
    expect(blockIds).toEqual(["h-a", "h-b"]);
    expect(JSON.stringify(doc)).toContain("감마");
  });

  it("cross-page(타 페이지) 링크는 기존대로 멘션으로 변환된다", () => {
    const html = [
      "<html><body><article class=\"page\">",
      "<p>자세한 내용은 <a href=\"other.html\">스택</a>을 참조하세요.</p>",
      "</article></body></html>",
    ].join("");
    const doc = notionHtmlToDoc(html, {
      resolvePageMentionByHref: () => ({ pageId: "other-page", label: "다른 페이지", intraPage: false }),
    });
    const mention = findMention(doc);
    expect(mention).toBeTruthy();
    expect(mention?.attrs?.mentionKind).toBe("page");
    expect(mention?.attrs?.id).toBe("p:other-page");
  });
});

describe("notionHtmlToDoc 콜아웃 줄바꿈 보존", () => {
  it("콜아웃 본문 div 내부의 <br> 을 hardBreak 로 보존한다", () => {
    const html = [
      "<html><body><article class=\"page\">",
      "<figure class=\"callout\" style=\"display:flex\">",
      "<div><span class=\"icon\">💡</span></div>",
      "<div style=\"width:100%\"><strong>첫 줄</strong><br/>둘째 줄<br/><br/>넷째 줄</div>",
      "</figure>",
      "</article></body></html>",
    ].join("");

    const doc = notionHtmlToDoc(html);
    const callout = doc.content?.find((n) => n.type === "callout");
    expect(callout).toBeTruthy();

    // 본문은 한 문단 안에 hardBreak 로 줄바꿈이 보존돼야 한다.
    const paragraph = callout?.content?.find((n) => n.type === "paragraph");
    expect(paragraph).toBeTruthy();
    const inlines = paragraph?.content ?? [];
    const hardBreaks = inlines.filter((n) => n.type === "hardBreak");
    // <br/> 3개 → hardBreak 3개
    expect(hardBreaks.length).toBe(3);

    const text = inlines
      .filter((n) => n.type === "text")
      .map((n) => n.text)
      .join("|");
    expect(text).toContain("첫 줄");
    expect(text).toContain("둘째 줄");
    expect(text).toContain("넷째 줄");
  });
});
