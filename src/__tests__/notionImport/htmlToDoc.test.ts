import { describe, expect, it } from "vitest";
import { notionHtmlToDoc } from "../../lib/notionImport/htmlToDoc";

describe("notionHtmlToDoc", () => {
  it("highlight/block color를 textStyle color로 변환한다", () => {
    const html = [
      "<html><body><article class=\"page\">",
      "<h3 class=\"block-color-blue\">제목</h3>",
      "<p><mark class=\"highlight-red\">빨강</mark> 일반</p>",
      "</article></body></html>",
    ].join("");

    const doc = notionHtmlToDoc(html);
    expect(doc.content?.[0]?.attrs).toMatchObject({ blockTextColor: "blue" });
    const marks = (doc.content ?? [])
      .flatMap((node) => node.content ?? [])
      .flatMap((inline) => inline.marks ?? []);

    expect(marks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "textStyle", attrs: { color: "#e11d48" } }),
      ]),
    );
  });

  it("figure.callout 구조를 callout 노드로 변환한다", () => {
    const html = [
      "<html><body><article class=\"page\">",
      "<figure class=\"block-color-blue_background callout\" style=\"display:flex\">",
      "<div><img class=\"icon notion-static-icon\" src=\"https://www.notion.so/icons/info-alternate_blue.svg\"/></div>",
      "<div><p><strong>Q. 질문</strong></p><p>A. 답변</p></div>",
      "</figure>",
      "</article></body></html>",
    ].join("");
    const doc = notionHtmlToDoc(html);
    expect(doc.content?.[0]?.type).toBe("callout");
    const calloutBlocks = doc.content?.[0]?.content ?? [];
    expect(calloutBlocks.some((b) => b.type === "paragraph")).toBe(true);
    const paragraphTexts = calloutBlocks
      .filter((b) => b.type === "paragraph")
      .flatMap((p) => p.content ?? [])
      .map((inline) => inline.type === "text" ? inline.text : "")
      .join(" ");
    expect(paragraphTexts).toContain("Q. 질문");
    expect(paragraphTexts).toContain("A. 답변");
  });

  it("callout 내부 줄바꿈과 중첩 리스트를 보존한다", () => {
    const html = [
      "<html><body><article class=\"page\">",
      "<figure class=\"callout\">",
      "<div><img src=\"icon.svg\"/></div>",
      "<div>",
      "<p>첫 줄<br/>둘째 줄</p>",
      "<ul><li>상위 항목<ul><li>하위 항목</li></ul></li></ul>",
      "</div>",
      "</figure>",
      "</article></body></html>",
    ].join("");
    const doc = notionHtmlToDoc(html);
    const calloutBlocks = doc.content?.[0]?.content ?? [];
    const firstParagraph = calloutBlocks.find((b) => b.type === "paragraph");
    expect(firstParagraph?.content?.some((c) => c.type === "hardBreak")).toBe(true);
    const firstList = calloutBlocks.find((b) => b.type === "bulletList");
    expect(firstList).toBeTruthy();
    const nested = firstList?.content?.[0]?.content?.find((c) => c.type === "bulletList");
    expect(nested?.type).toBe("bulletList");
  });

  it("callout 내부 부모 색상 클래스를 텍스트 블록에 상속한다", () => {
    const html = [
      "<html><body><article class=\"page\">",
      "<figure class=\"callout\">",
      "<div class=\"block-color-blue\"><p>파란 문단</p></div>",
      "</figure>",
      "</article></body></html>",
    ].join("");
    const doc = notionHtmlToDoc(html);
    const calloutBlocks = doc.content?.[0]?.content ?? [];
    expect(calloutBlocks[0]?.attrs).toMatchObject({ blockTextColor: "blue" });
  });

  it("중첩 ul을 형제 리스트로 중복 생성하지 않는다", () => {
    const html = [
      "<html><body><article class=\"page\">",
      "<ul><li>상위<ul><li>하위</li></ul></li></ul>",
      "</article></body></html>",
    ].join("");
    const doc = notionHtmlToDoc(html);
    const topLists = (doc.content ?? []).filter((b) => b.type === "bulletList");
    expect(topLists.length).toBe(1);
    const nested = topLists[0]?.content?.[0]?.content?.find((c) => c.type === "bulletList");
    expect(nested?.type).toBe("bulletList");
  });

  it("details를 toggle 노드로 변환한다", () => {
    const html = [
      "<html><body><article class=\"page\">",
      "<details open><summary><strong>토글 제목</strong></summary><p>토글 본문</p></details>",
      "</article></body></html>",
    ].join("");
    const doc = notionHtmlToDoc(html);
    expect(doc.content?.[0]?.type).toBe("toggle");
    expect(doc.content?.[0]?.content?.[0]?.type).toBe("toggleHeader");
    expect(doc.content?.[0]?.content?.[1]?.type).toBe("toggleContent");
  });

  it("ul.toggle 래퍼는 일반 리스트로 중복 변환하지 않는다", () => {
    const html = [
      "<html><body><article class=\"page\">",
      "<ul class=\"toggle\"><li><details open><summary>제목</summary><p>본문</p></details></li></ul>",
      "</article></body></html>",
    ].join("");
    const doc = notionHtmlToDoc(html);
    const topTypes = (doc.content ?? []).map((n) => n.type);
    expect(topTypes).toEqual(["toggle"]);
  });

  it("중첩 details는 상위 토글 내부로만 변환하고 루트 중복 생성하지 않는다", () => {
    const html = [
      "<html><body><article class=\"page\">",
      "<details open><summary>상위</summary>",
      "<details open><summary>하위</summary><p>하위 본문</p></details>",
      "</details>",
      "</article></body></html>",
    ].join("");
    const doc = notionHtmlToDoc(html);
    const topToggles = (doc.content ?? []).filter((n) => n.type === "toggle");
    expect(topToggles.length).toBe(1);
    const nested = topToggles[0]?.content?.[1]?.content?.find((n) => n.type === "toggle");
    expect(nested?.type).toBe("toggle");
  });

  it("collection table을 table 노드로 변환한다", () => {
    const html = [
      "<html><body><article class=\"page\">",
      "<table class=\"collection-content\"><thead><tr><th>제목</th><th>상태</th></tr></thead><tbody><tr><td><a href=\"a.html\">행1</a></td><td>완료</td></tr></tbody></table>",
      "</article></body></html>",
    ].join("");
    const doc = notionHtmlToDoc(html);
    const table = doc.content?.[0];
    expect(table?.type).toBe("table");
    expect(table?.content?.[0]?.type).toBe("tableRow");
    expect(table?.content?.[0]?.content?.[0]?.type).toBe("tableHeader");
    expect(table?.content?.[1]?.content?.[0]?.type).toBe("tableCell");
  });

  it("이미지 노드를 커스텀 첨부 노드로 대체할 수 있다", () => {
    const html = [
      "<html><body><article class=\"page\">",
      "<figure><img src=\"media/big.gif\" alt=\"큰 GIF\"/></figure>",
      "</article></body></html>",
    ].join("");
    const doc = notionHtmlToDoc(html, {
      resolveImageNode: () => ({
        type: "fileBlock",
        attrs: {
          src: "quicknote-file://asset-1",
          name: "big.gif",
          mime: "image/gif",
        },
      }),
    });
    expect(doc.content?.[0]?.type).toBe("fileBlock");
    expect(doc.content?.[0]?.attrs).toMatchObject({ name: "big.gif" });
  });

  it("figure 내부 동영상을 첨부 노드로 변환할 수 있다", () => {
    const html = [
      "<html><body><article class=\"page\">",
      "<figure><video controls><source src=\"media/movie.mp4\" type=\"video/mp4\"/></video></figure>",
      "</article></body></html>",
    ].join("");
    const doc = notionHtmlToDoc(html, {
      resolveMediaNode: () => ({
        type: "fileBlock",
        attrs: {
          src: "quicknote-file://video-1",
          name: "movie.mp4",
          mime: "video/mp4",
        },
      }),
    });
    expect(doc.content?.[0]?.type).toBe("fileBlock");
    expect(doc.content?.[0]?.attrs).toMatchObject({ mime: "video/mp4" });
  });

  it("문단 단독 로컬 첨부 링크를 첨부 노드로 변환할 수 있다", () => {
    const html = [
      "<html><body><article class=\"page\">",
      "<p><a href=\"files/manual.pdf\">manual.pdf</a></p>",
      "</article></body></html>",
    ].join("");
    const doc = notionHtmlToDoc(html, {
      resolveMediaNode: () => ({
        type: "fileBlock",
        attrs: {
          src: "quicknote-file://pdf-1",
          name: "manual.pdf",
          mime: "application/pdf",
        },
      }),
    });
    expect(doc.content?.[0]?.type).toBe("fileBlock");
    expect(doc.content?.[0]?.attrs).toMatchObject({ name: "manual.pdf" });
  });

  it("figure source 로 노출된 zip 첨부를 첨부 노드로 변환한다", () => {
    const html = [
      "<html><body><article class=\"page\">",
      "<figure><div class=\"source\"><a href=\"files/plugin.zip\">attachment:id:plugin.zip</a></div></figure>",
      "</article></body></html>",
    ].join("");
    const doc = notionHtmlToDoc(html, {
      resolveMediaNode: () => ({
        type: "fileBlock",
        attrs: {
          src: "quicknote-file://zip-1",
          name: "plugin.zip",
          mime: "application/zip",
        },
      }),
    });
    expect(doc.content?.[0]?.type).toBe("fileBlock");
    expect(doc.content?.[0]?.attrs).toMatchObject({ name: "plugin.zip" });
  });

  it("collection table 셀의 날짜/상태 메타를 추출한다", () => {
    const html = [
      "<html><body><article class=\"page\">",
      "<table class=\"collection-content\"><thead><tr><th>제목</th><th>일정</th><th>직군</th></tr></thead>",
      "<tbody><tr><td><a href=\"a.html\">행1</a></td><td><time>2026-05-20</time></td><td><span class=\"select-value-color-green\">완료</span></td></tr></tbody></table>",
      "</article></body></html>",
    ].join("");
    let tableMeta: unknown = null;
    notionHtmlToDoc(html, {
      currentPagePath: "root/page.html",
      onCollectionTable: (table) => {
        tableMeta = table;
        return "db-1";
      },
    });
    const parsed = tableMeta as {
      rows: Array<{
        cellMeta: Array<{ hasTimeTag: boolean; statusColorToken: string | null; statusLike: boolean }>;
      }>;
    };
    expect(parsed.rows[0]?.cellMeta[1]?.hasTimeTag).toBe(true);
    expect(parsed.rows[0]?.cellMeta[2]?.statusColorToken).toBe("green");
    expect(parsed.rows[0]?.cellMeta[2]?.statusLike).toBe(true);
  });

  it("노션 리다이렉트 링크를 실제 외부 링크로 정규화한다", () => {
    const html = [
      "<html><body><article class=\"page\">",
      "<p>문서 <a href=\"/redirected?url=https%3A%2F%2Fexample.com%2Fdocs\">링크</a> 확인</p>",
      "</article></body></html>",
    ].join("");
    const doc = notionHtmlToDoc(html);
    const marks = (doc.content?.[0]?.content ?? []).flatMap((n) => n.marks ?? []);
    const linkMark = marks.find((m) => m.type === "link");
    expect(linkMark?.attrs).toMatchObject({ href: "https://example.com/docs" });
  });

  it("문단 단독 링크를 북마크 블록으로 변환한다", () => {
    const html = [
      "<html><body><article class=\"page\">",
      "<p><a href=\"https://example.com\">https://example.com</a></p>",
      "</article></body></html>",
    ].join("");
    const doc = notionHtmlToDoc(html);
    expect(doc.content?.[0]?.type).toBe("bookmarkBlock");
    expect(doc.content?.[0]?.attrs).toMatchObject({ href: "https://example.com/" });
  });

  it("내부 페이지 링크를 페이지 멘션으로 변환한다", () => {
    const html = [
      "<html><body><article class=\"page\">",
      "<p>관련 문서: <a href=\"./sub-page.html\">서브 페이지</a></p>",
      "</article></body></html>",
    ].join("");
    const doc = notionHtmlToDoc(html, {
      resolvePageMentionByHref: (href) =>
        href.includes("sub-page.html")
          ? { pageId: "page-sub", label: "서브 페이지" }
          : null,
    });
    const mentionNode = (doc.content?.[0]?.content ?? []).find((n) => n.type === "mention");
    expect(mentionNode?.type).toBe("mention");
    expect(mentionNode?.attrs).toMatchObject({
      id: "p:page-sub",
      mentionKind: "page",
    });
  });

  it("토글 내부 link-to-page figure를 이미지가 아닌 페이지 멘션으로 변환한다", () => {
    const html = [
      "<html><body><article class=\"page\">",
      "<ul class=\"block-color-blue toggle\"><li><details open><summary>Q. 이름의 의미는?</summary>",
      "<div><figure class=\"link-to-page\"><a href=\"CAT/%ED%8C%80%EB%AA%85%20CAT%2015aba942253480fea915f11df733ff21.html\">",
      "<img class=\"icon notion-static-icon\" src=\"https://www.notion.so/icons/thought-dialogue_purple.svg\"/>팀명 : CAT</a></figure></div>",
      "</details></li></ul>",
      "</article></body></html>",
    ].join("");
    const doc = notionHtmlToDoc(html, {
      resolvePageMentionByHref: (href) =>
        href.includes("15aba942253480fea915f11df733ff21")
          ? { pageId: "page-cat", label: "팀명 : CAT" }
          : null,
    });
    const toggle = doc.content?.[0];
    const header = toggle?.content?.[0];
    const toggleContent = toggle?.content?.[1]?.content ?? [];
    const mentionBlock = toggleContent.find((node) => node.type === "paragraph" && node.content?.[0]?.type === "mention");

    expect(toggle?.type).toBe("toggle");
    expect(toggle?.attrs).toMatchObject({ blockTextColor: "blue" });
    expect(header?.attrs).toMatchObject({ blockTextColor: "blue" });
    expect(mentionBlock?.content?.[0]?.attrs).toMatchObject({
      id: "p:page-cat",
      mentionKind: "page",
    });
    expect(toggleContent.some((node) => node.type === "image")).toBe(false);
  });

  it("문단 내 대시 목록 텍스트를 불릿 목록으로 변환한다", () => {
    const html = [
      "<html><body><article class=\"page\">",
      "<details open><summary>토글</summary>",
      "<p>출퇴근 / 휴가는 flex를 통해 진행합니다.<br>- 근무 기록은 미리 등록하지 않고 출근 후 체크하면,<br>자동으로 업무 시간이 기록됩니다.<br>- 오전 출근과 동시에 flex에서 근무 시작 버튼 클릭하기</p>",
      "</details>",
      "</article></body></html>",
    ].join("");
    const doc = notionHtmlToDoc(html);
    const toggleContent = doc.content?.[0]?.content?.[1]?.content ?? [];
    expect(toggleContent[0]?.type).toBe("paragraph");
    expect(toggleContent[1]?.type).toBe("bulletList");
    const firstItemParagraph = toggleContent[1]?.content?.[0]?.content?.[0];
    expect(firstItemParagraph?.content?.some((n) => n.type === "hardBreak")).toBe(true);
  });
});
