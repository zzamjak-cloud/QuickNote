// 공개 뷰어 doc 변환 — 자산 치환·placeholder·pageLink 강등 검증.
import { describe, it, expect, vi } from "vitest";
import type { JSONContent } from "@tiptap/react";

vi.stubEnv("VITE_PUBLIC_VIEW_URL", "https://public.example/");

import { transformPublicDoc } from "../transformPublicDoc";

const ctx = {
  token: "tok-1234567890abcdef",
  pageId: "page-1",
  publishedPageIds: new Set(["page-1", "child-1"]),
};

describe("transformPublicDoc", () => {
  it("quicknote-image:// src 를 공개 asset URL 로 치환한다", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [{ type: "image", attrs: { src: "quicknote-image://img-1", width: 100 } }],
    };
    const out = transformPublicDoc(doc, ctx);
    const img = out.content?.[0];
    const src = img?.attrs?.src as string;
    expect(src).toContain("op=asset");
    expect(src).toContain("assetId=img-1");
    expect(src).toContain(`token=${ctx.token}`);
    // 다른 attrs 보존 + 원본 불변
    expect(img?.attrs?.width).toBe(100);
    expect(doc.content?.[0]?.attrs?.src).toBe("quicknote-image://img-1");
  });

  it("databaseBlock/flowchartBlock 은 placeholder 문단으로 치환한다", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        { type: "databaseBlock", attrs: { databaseId: "db-1" } },
        { type: "flowchartBlock", attrs: { flowchartId: "fc-1" } },
      ],
    };
    const out = transformPublicDoc(doc, ctx);
    expect(out.content?.[0]?.type).toBe("paragraph");
    expect(out.content?.[1]?.type).toBe("paragraph");
    expect(JSON.stringify(out)).not.toContain("db-1");
  });

  it("게시 트리 안 pageLink 는 공개 라우트 링크 텍스트로 변환한다", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "pageLink", attrs: { id: "child-1", label: "자식 페이지" } }],
        },
      ],
    };
    const out = transformPublicDoc(doc, ctx);
    const link = out.content?.[0]?.content?.[0];
    expect(link?.type).toBe("text");
    expect(link?.text).toBe("자식 페이지");
    expect(link?.marks?.[0]?.attrs?.href).toBe(
      `/p/${ctx.token}?page=child-1`,
    );
  });

  it("게시 트리 밖 pageLink 는 순수 텍스트로 강등한다(id 비노출)", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "pageLink", attrs: { id: "secret-1", label: "비공개" } }],
        },
      ],
    };
    const out = transformPublicDoc(doc, ctx);
    const text = out.content?.[0]?.content?.[0];
    expect(text?.type).toBe("text");
    expect(text?.marks).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain("secret-1");
  });
});
