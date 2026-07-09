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
    const inline = out.content?.[0]?.content ?? [];
    expect(inline).toHaveLength(1);
    expect(inline[0]?.type).toBe("text");
    expect(inline[0]?.text).toBe("자식 페이지");
    expect(inline[0]?.marks?.[0]?.attrs?.href).toBe(
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

  it("게시 트리 안 페이지 멘션은 이모지 아이콘 + 공개 라우트 링크로 변환한다", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "mention",
              attrs: { id: "p:child-1", mentionKind: "page", label: "자식" },
            },
          ],
        },
      ],
    };
    const out = transformPublicDoc(doc, {
      ...ctx,
      pageIcons: new Map([["child-1", "📌"]]),
    });
    const inline = out.content?.[0]?.content ?? [];
    expect(inline).toHaveLength(2);
    expect(inline[0]?.type).toBe("text");
    expect(inline[0]?.text).toBe("📌 ");
    expect(inline[1]?.type).toBe("text");
    expect(inline[1]?.text).toBe("자식");
    expect(inline[1]?.marks?.[0]?.attrs?.href).toBe(`/p/${ctx.token}?page=child-1`);
  });

  it("페이지 멘션 Lucide 아이콘은 lucideInlineIcon 노드로 변환한다", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "mention",
              attrs: { id: "p:child-1", mentionKind: "page", label: "자식" },
            },
          ],
        },
      ],
    };
    const out = transformPublicDoc(doc, {
      ...ctx,
      pageIcons: new Map([["child-1", "quicknote-lucide:Star:ff0000"]]),
    });
    const inline = out.content?.[0]?.content ?? [];
    expect(inline[0]?.type).toBe("lucideInlineIcon");
    expect(inline[0]?.attrs?.name).toBe("Star");
    expect(inline[1]?.marks?.[0]?.attrs?.href).toBe(`/p/${ctx.token}?page=child-1`);
  });

  it("페이지 멘션 이미지 아이콘은 imageInlineIcon + 대상 pageId asset URL 로 변환한다", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "mention",
              attrs: { id: "p:child-1", mentionKind: "page", label: "자식" },
            },
          ],
        },
      ],
    };
    const out = transformPublicDoc(doc, {
      ...ctx,
      pageIcons: new Map([["child-1", "quicknote-image://ico-1"]]),
    });
    const inline = out.content?.[0]?.content ?? [];
    expect(inline[0]?.type).toBe("imageInlineIcon");
    const src = inline[0]?.attrs?.src as string;
    expect(src).toContain("assetId=ico-1");
    expect(src).toContain("pageId=child-1");
  });

  it("callout emoji·tab icon 의 quicknote-image:// 를 공개 URL 로 치환한다", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        { type: "callout", attrs: { emoji: "quicknote-image://ico-1" }, content: [] },
        {
          type: "tabBlock",
          content: [{ type: "tabPanel", attrs: { icon: "quicknote-image://ico-2" } }],
        },
      ],
    };
    const out = transformPublicDoc(doc, ctx);
    expect(String(out.content?.[0]?.attrs?.emoji)).toContain("assetId=ico-1");
    expect(String(out.content?.[1]?.content?.[0]?.attrs?.icon)).toContain("assetId=ico-2");
  });
});
