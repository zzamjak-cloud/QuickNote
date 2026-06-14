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
  const html = [
    "<html><body><article class=\"page\">",
    "<p>자세한 내용은 <a href=\"self.html\">스택</a>을 참조하세요.</p>",
    "</article></body></html>",
  ].join("");

  it("자기참조 링크는 멘션이 아니라 라벨 보존 링크 마크 텍스트로 변환된다", () => {
    const doc = notionHtmlToDoc(html, {
      // 자기참조 신호: intraPage true
      resolvePageMentionByHref: () => ({ pageId: "page-self", label: "현재 페이지 제목", intraPage: true }),
    });

    // 멘션이 생성되면 안 된다(멘션은 페이지 제목을 reactive 표시하므로 라벨이 사라짐).
    expect(findMention(doc)).toBeNull();

    const linkNode = findLinkTextNode(doc);
    expect(linkNode).toBeTruthy();
    // 라벨(용어명)이 그대로 보존돼야 한다.
    expect(linkNode?.text).toBe("스택");

    const linkMark = (linkNode?.marks ?? []).find((m) => m.type === "link");
    const href = String(linkMark?.attrs?.href ?? "");
    const target = parseQuickNoteLink(href);
    expect(target?.pageId).toBe("page-self");
    // href 에 점프용 text(용어명) 파라미터가 실린다.
    expect(target?.text).toBe("스택");
  });

  it("cross-page(타 페이지) 링크는 기존대로 멘션으로 변환된다", () => {
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
