import { describe, expect, it } from "vitest";
import { notionHtmlToDoc } from "../../lib/notionImport/htmlToDoc";
import type { JSONContent } from "@tiptap/react";

// 회귀: <aside> 콜아웃 내부 이미지가 리졸버(resolveImageNode)를 거치지 못해
// 원본 노션 상대경로로 남던 버그(업로드된 자산과 미연결 → 미사용 자산 + 404).
// calloutFromAside 가 options 를 본문 변환에 전달하지 않던 것이 원인.

function collectImages(doc: JSONContent, acc: string[]): void {
  if (doc.type === "image") acc.push(String((doc.attrs as { src?: string })?.src ?? ""));
  if (Array.isArray(doc.content)) for (const c of doc.content) collectImages(c, acc);
}

describe("aside 콜아웃 내부 이미지 리졸버 전달", () => {
  it("aside 안의 figure.image 도 resolveImageNode 를 거쳐 자산 ref 로 연결된다", () => {
    const html = `<article class="page"><div class="page-body">
      <aside>
        <div>수익 분석</div>
        <figure class="image"><a href="Foo/image.png"><img src="Foo/image.png"/></a></figure>
      </aside>
    </div></article>`;

    const requested: string[] = [];
    const doc = notionHtmlToDoc(html, {
      resolveImageNode: (src) => {
        requested.push(src);
        return { type: "image", attrs: { src: `asset://${src}` } };
      },
      resolveMediaNode: () => null,
      resolveImageSrc: (src) => (/^https?:\/\//i.test(src) ? src : null),
    });

    // 리졸버가 호출되어야 하고(=raw 경로 폴백이 아님),
    expect(requested).toContain("Foo/image.png");
    // 최종 이미지 노드는 리졸버가 준 자산 ref 여야 한다(원본 상대경로가 아님).
    const imgs: string[] = [];
    collectImages(doc, imgs);
    expect(imgs).toContain("asset://Foo/image.png");
    expect(imgs).not.toContain("Foo/image.png");
  });
});
