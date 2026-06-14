import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/react";
import { pageDocToHtml } from "../pageToHtml";
import { notionHtmlToDoc } from "../../notionImport/htmlToDoc";

// pageDocToHtml 결과(전체 HTML 문서)에서 본문만 article.page 로 감싸 파서에 넘긴다.
// (htmlToDoc 는 article.page 를 우선 탐색하고 없으면 body 로 폴백한다)
function roundtrip(doc: JSONContent): JSONContent {
  const html = pageDocToHtml("테스트", doc);
  const bodyMatch = html.match(/<body>([\s\S]*?)<\/body>/i);
  const bodyInner = bodyMatch?.[1] ?? "";
  // 제목 h1(맨 앞)은 본문이 아니므로 제거 — 첫 <h1>…</h1> 만 떼어낸다.
  const withoutTitle = bodyInner.replace(/<h1>[\s\S]*?<\/h1>/i, "");
  return notionHtmlToDoc(`<html><body><article class="page">${withoutTitle}</article></body></html>`);
}

// doc 트리에서 특정 타입 노드를 모두 수집(깊이 우선).
function collectByType(node: JSONContent, type: string): JSONContent[] {
  const out: JSONContent[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === type) out.push(n);
    for (const c of n.content ?? []) walk(c);
  };
  walk(node);
  return out;
}

function allText(node: JSONContent): string {
  let s = "";
  const walk = (n: JSONContent) => {
    if (n.type === "text") s += n.text ?? "";
    for (const c of n.content ?? []) walk(c);
  };
  walk(node);
  return s;
}

function makeDoc(...blocks: JSONContent[]): JSONContent {
  return { type: "doc", content: blocks };
}

describe("pageToHtml 라운드트립 (export → notion import)", () => {
  it("callout 을 aside 로 내보내고 callout 으로 복원한다", () => {
    const doc = makeDoc({
      type: "callout",
      attrs: { preset: "info", emoji: "🔥" },
      content: [{ type: "paragraph", content: [{ type: "text", text: "콜아웃 본문" }] }],
    });
    const restored = roundtrip(doc);
    const callouts = collectByType(restored, "callout");
    expect(callouts.length).toBe(1);
    expect(allText(callouts[0]!)).toContain("콜아웃 본문");
  });

  it("toggle 을 details/summary 로 내보내고 toggle 로 복원한다", () => {
    const doc = makeDoc({
      type: "toggle",
      attrs: { open: true },
      content: [
        { type: "toggleHeader", content: [{ type: "text", text: "토글 제목" }] },
        {
          type: "toggleContent",
          content: [{ type: "paragraph", content: [{ type: "text", text: "토글 내용" }] }],
        },
      ],
    });
    const restored = roundtrip(doc);
    const toggles = collectByType(restored, "toggle");
    expect(toggles.length).toBe(1);
    const header = collectByType(toggles[0]!, "toggleHeader");
    expect(allText(header[0]!)).toContain("토글 제목");
    const content = collectByType(toggles[0]!, "toggleContent");
    expect(allText(content[0]!)).toContain("토글 내용");
  });

  it("columnLayout 을 div.column-list 로 내보내고 복원한다", () => {
    const doc = makeDoc({
      type: "columnLayout",
      attrs: { columns: 2 },
      content: [
        {
          type: "column",
          content: [{ type: "paragraph", content: [{ type: "text", text: "왼쪽" }] }],
        },
        {
          type: "column",
          content: [{ type: "paragraph", content: [{ type: "text", text: "오른쪽" }] }],
        },
      ],
    });
    const restored = roundtrip(doc);
    const layouts = collectByType(restored, "columnLayout");
    expect(layouts.length).toBe(1);
    const columns = collectByType(layouts[0]!, "column");
    expect(columns.length).toBe(2);
    expect(allText(layouts[0]!)).toContain("왼쪽");
    expect(allText(layouts[0]!)).toContain("오른쪽");
  });

  it("bookmarkBlock 을 figure.bookmark 로 내보내고 복원한다", () => {
    const doc = makeDoc({
      type: "bookmarkBlock",
      attrs: {
        href: "https://example.com/article",
        title: "예시 글 제목",
        description: "예시 설명",
        siteName: "example.com",
        imageUrl: "https://example.com/img.png",
        status: "ready",
      },
    });
    const restored = roundtrip(doc);
    const bookmarks = collectByType(restored, "bookmarkBlock");
    expect(bookmarks.length).toBe(1);
    expect(bookmarks[0]!.attrs?.href).toBe("https://example.com/article");
    expect(bookmarks[0]!.attrs?.title).toBe("예시 글 제목");
    expect(bookmarks[0]!.attrs?.description).toBe("예시 설명");
  });

  it("youtube 를 iframe figure 로 내보내고 복원한다", () => {
    const doc = makeDoc({
      type: "youtube",
      attrs: { src: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    });
    const restored = roundtrip(doc);
    const youtubes = collectByType(restored, "youtube");
    expect(youtubes.length).toBe(1);
    expect(String(youtubes[0]!.attrs?.src)).toContain("dQw4w9WgXcQ");
  });

  it("이미지 캡션을 figure.image + figcaption 으로 내보내고 복원한다", () => {
    const doc = makeDoc({
      type: "image",
      attrs: { src: "https://example.com/photo.png", alt: "사진", caption: "사진 캡션" },
    });
    const restored = roundtrip(doc);
    const images = collectByType(restored, "image");
    expect(images.length).toBe(1);
    expect(images[0]!.attrs?.src).toBe("https://example.com/photo.png");
    expect(images[0]!.attrs?.caption).toBe("사진 캡션");
  });

  it("캡션 없는 이미지는 단순 img 로 유지(복원 시 캡션 없음)", () => {
    const doc = makeDoc({
      type: "image",
      attrs: { src: "https://example.com/plain.png", alt: "평범" },
    });
    const restored = roundtrip(doc);
    const images = collectByType(restored, "image");
    expect(images.length).toBe(1);
    expect(images[0]!.attrs?.caption).toBeUndefined();
  });

  it("fileBlock 은 다운로드 링크로 보존한다", () => {
    const doc = makeDoc({
      type: "fileBlock",
      attrs: { src: "https://example.com/files/report.pdf", name: "report.pdf" },
    });
    const restored = roundtrip(doc);
    // 파서는 자산 리졸버 없이는 fileBlock 으로 복원하지 않고 단일 anchor 문단을 북마크로 변환한다.
    // 데이터 누출 없이 파일 URL 이 보존됨을 확인(href 또는 본문 텍스트 어디든).
    const serialized = JSON.stringify(restored);
    expect(serialized).toContain("report.pdf");
  });

  it("tabBlock 은 각 패널을 제목+내용 섹션으로 펼친다", () => {
    const doc = makeDoc({
      type: "tabBlock",
      attrs: { placement: "top", activeIndex: 0 },
      content: [
        {
          type: "tabPanel",
          attrs: { id: "t1", title: "첫 탭" },
          content: [{ type: "paragraph", content: [{ type: "text", text: "첫 내용" }] }],
        },
        {
          type: "tabPanel",
          attrs: { id: "t2", title: "둘 탭" },
          content: [{ type: "paragraph", content: [{ type: "text", text: "둘 내용" }] }],
        },
      ],
    });
    const restored = roundtrip(doc);
    const text = allText(restored);
    expect(text).toContain("첫 탭");
    expect(text).toContain("첫 내용");
    expect(text).toContain("둘 탭");
    expect(text).toContain("둘 내용");
  });

  it("기존 처리 블록(heading/paragraph/list/code) 출력은 변하지 않는다", () => {
    const doc = makeDoc(
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "제목2" }] },
      { type: "paragraph", content: [{ type: "text", text: "문단" }] },
    );
    const html = pageDocToHtml("t", doc);
    expect(html).toContain("<h2>제목2</h2>");
    expect(html).toContain("<p>문단</p>");
  });
});
