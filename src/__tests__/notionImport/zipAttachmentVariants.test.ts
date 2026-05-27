import { describe, expect, it } from "vitest";
import { notionHtmlToDoc } from "../../lib/notionImport/htmlToDoc";

const resolveZip = () => ({
  type: "fileBlock",
  attrs: { src: "quicknote-file://zip-1", name: "plugin.zip", mime: "application/zip" },
});

describe("zip 첨부 변형", () => {
  it("A. figure.file (source div 없음, a 직속)", () => {
    const html =
      '<html><body><article class="page"><figure class="file"><a href="files/plugin.zip">plugin.zip</a></figure></article></body></html>';
    const doc = notionHtmlToDoc(html, { resolveMediaNode: resolveZip });
    expect(doc.content?.[0]?.type).toBe("fileBlock");
  });

  it("B. bare figure > a", () => {
    const html =
      '<html><body><article class="page"><figure><a href="files/plugin.zip">plugin.zip</a></figure></article></body></html>';
    const doc = notionHtmlToDoc(html, { resolveMediaNode: resolveZip });
    expect(doc.content?.[0]?.type).toBe("fileBlock");
  });

  it("C. li 안의 figure.file zip", () => {
    const html =
      '<html><body><article class="page"><ul><li>항목<figure class="file"><a href="files/plugin.zip">plugin.zip</a></figure></li></ul></article></body></html>';
    const doc = notionHtmlToDoc(html, { resolveMediaNode: resolveZip });
    // 어딘가에 fileBlock 이 존재해야 한다 (리스트 안이든 형제로든)
    const json = JSON.stringify(doc);
    expect(json).toContain("fileBlock");
  });

  it("D. 이미지처럼 보이는 확장자 없는 attachment 텍스트", () => {
    const html =
      '<html><body><article class="page"><figure class="file"><a href="files/plugin.zip">attachment:abc:plugin.zip</a></figure></article></body></html>';
    const doc = notionHtmlToDoc(html, { resolveMediaNode: resolveZip });
    expect(doc.content?.[0]?.type).toBe("fileBlock");
  });

  it("E. div(.source) 없이 figure 안에 p>a", () => {
    const html =
      '<html><body><article class="page"><figure><p><a href="files/plugin.zip">plugin.zip</a></p></figure></article></body></html>';
    const doc = notionHtmlToDoc(html, { resolveMediaNode: resolveZip });
    expect(doc.content?.[0]?.type).toBe("fileBlock");
  });
});
