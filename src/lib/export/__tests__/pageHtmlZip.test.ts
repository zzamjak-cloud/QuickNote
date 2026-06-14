import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import type { JSONContent } from "@tiptap/react";
import { encodeImageRef } from "../../sync/imageScheme";

// readMediaBlob 이 캐시 바이트(png blob)를 반환하도록 모킹 — getMediaObjectUrl 경로는 타지 않는다.
vi.mock("../../media/mediaBlobCache", () => ({
  readMediaBlob: vi.fn(async (id: string) =>
    id === "img-1" ? new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }) : null,
  ),
  getMediaObjectUrl: vi.fn(async () => null),
}));

import { buildPageHtmlZipBlob } from "../pageHtmlZip";

function makeDoc(): JSONContent {
  return {
    type: "doc",
    content: [
      { type: "image", attrs: { src: encodeImageRef("img-1"), alt: "그림" } },
    ],
  };
}

describe("buildPageHtmlZipBlob", () => {
  it("이미지 ref 의 바이트를 assets/{id}.png 로 묶고 HTML src 를 상대경로로 바꾼다", async () => {
    const blob = await buildPageHtmlZipBlob("내 페이지", makeDoc());
    const zip = await JSZip.loadAsync(blob);

    // 자산 파일이 존재한다.
    expect(zip.file("assets/img-1.png")).not.toBeNull();

    // HTML 파일은 제목 새니타이즈 결과명으로 추가된다.
    const htmlEntry = zip.file("내 페이지.html");
    expect(htmlEntry).not.toBeNull();
    const html = await htmlEntry!.async("string");

    // <img src> 가 zip 내 상대경로를 가리킨다(quicknote-image:// 스킴이 사라진다).
    expect(html).toContain('src="assets/img-1.png"');
    expect(html).not.toContain("quicknote-image://");
  });

  it("바이트를 얻지 못하면 원본 src 를 유지하고 자산을 추가하지 않는다", async () => {
    const doc: JSONContent = {
      type: "doc",
      content: [{ type: "image", attrs: { src: encodeImageRef("missing"), alt: "" } }],
    };
    const blob = await buildPageHtmlZipBlob("p", doc);
    const zip = await JSZip.loadAsync(blob);

    expect(zip.file("assets/missing.png")).toBeNull();
    const html = await zip.file("p.html")!.async("string");
    expect(html).toContain("quicknote-image://missing");
  });
});
