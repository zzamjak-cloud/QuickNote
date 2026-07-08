// 공개 뷰어용 doc 변환 — 비로그인 환경에서 렌더 불가/부적합한 노드를 치환한다.
//  - quicknote-image://·quicknote-file:// → 공개 asset URL (imageBlock/fileBlock 무수정 재사용)
//  - databaseBlock/flowchartBlock → 컴팩트 플레이스홀더 문단 (BlockDiffView toPreviewBlock 선례)
//  - pageLink: 게시 트리 안 → 유지(뷰어가 클릭을 공개 라우트로 처리), 밖 → 텍스트 강등
// sanitizeDocImages.ts 의 불변 재귀 walk 패턴을 따른다.

import type { JSONContent } from "@tiptap/react";
import { decodeImageRef } from "../sync/imageScheme";
import { decodeFileRef } from "../files/scheme";
import { buildPublicAssetUrl } from "./api";

export type PublicDocContext = {
  token: string;
  pageId: string;
  /** 게시 트리(루트+자손)에 포함된 페이지 id 집합 */
  publishedPageIds: ReadonlySet<string>;
};

function placeholderParagraph(text: string): JSONContent {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

/** 자산 스킴 문자열이면 공개 asset URL 로 치환, 아니면 원본 유지. */
export function toPublicAssetUrl(
  value: unknown,
  ctx: PublicDocContext,
): string | null {
  if (typeof value !== "string") return null;
  const assetId = decodeImageRef(value) ?? decodeFileRef(value);
  if (!assetId) return null;
  return buildPublicAssetUrl(ctx.token, ctx.pageId, assetId);
}

function transformNode(node: JSONContent, ctx: PublicDocContext): JSONContent {
  // 1차 미지원 블록 — 플레이스홀더로 치환
  if (node.type === "databaseBlock") {
    return placeholderParagraph("📊 인라인 데이터베이스 (공개 페이지에서는 표시되지 않습니다)");
  }
  if (node.type === "flowchartBlock") {
    return placeholderParagraph("🔀 플로우차트 (공개 페이지에서는 표시되지 않습니다)");
  }
  // 페이지 링크 — NodeView 클릭 핸들러가 로그인 store 를 전제하므로 링크 텍스트로 강등한다.
  // 게시 트리 안 대상이면 공개 라우트 링크, 밖이면 순수 텍스트(공개 범위 밖 페이지 비노출).
  if (node.type === "pageLink") {
    const targetId = typeof node.attrs?.id === "string" ? node.attrs.id : null;
    const label = typeof node.attrs?.label === "string" ? node.attrs.label : "페이지";
    if (!targetId || !ctx.publishedPageIds.has(targetId)) {
      return { type: "text", text: label || "페이지" };
    }
    return {
      type: "text",
      text: label || "페이지",
      marks: [
        { type: "link", attrs: { href: `/p/${ctx.token}?page=${targetId}` } },
      ],
    };
  }
  // 자산 스킴 src 치환 (image/file/video 계열 공통 — attrs.src 만 본다)
  const src = node.attrs?.src;
  const publicSrc = toPublicAssetUrl(src, ctx);
  let next = node;
  if (publicSrc) {
    next = { ...node, attrs: { ...node.attrs, src: publicSrc } };
  }
  if (!next.content?.length) return next;
  return { ...next, content: next.content.map((child) => transformNode(child, ctx)) };
}

/**
 * 공개 뷰어 렌더 직전 doc 변환. 원본을 변경하지 않고 새 트리를 반환한다.
 * pageLink 를 텍스트로 강등하면 부모가 인라인 컨텍스트일 때만 유효하므로,
 * pageLink 는 항상 인라인 노드로 쓰인다는 전제(에디터 스키마)와 일치한다.
 */
export function transformPublicDoc(
  doc: JSONContent,
  ctx: PublicDocContext,
): JSONContent {
  return transformNode(doc, ctx);
}
