// 공개 뷰어용 doc 변환 — 비로그인 환경에서 렌더 불가/부적합한 노드를 치환한다.
//  - quicknote-image://·quicknote-file:// → 공개 asset URL (src·icon·emoji attrs)
//  - databaseBlock/flowchartBlock → 컴팩트 플레이스홀더 문단
//  - pageLink / 페이지 멘션 → 게시 트리 안이면 공개 라우트 링크, 밖이면 텍스트 강등
// sanitizeDocImages.ts 의 불변 재귀 walk 패턴을 따른다.

import type { JSONContent } from "@tiptap/react";
import { decodeImageRef } from "../sync/imageScheme";
import { decodeFileRef } from "../files/scheme";
import { buildPublicAssetUrl } from "./api";
import {
  isPageMention,
  stripPagePrefix,
} from "../tiptapExtensions/mentionKind";
import {
  decodeLucidePageIcon,
  isImageLikePageIcon,
} from "../pageIcon";

export type PublicDocContext = {
  token: string;
  pageId: string;
  /** 게시 트리(루트+자손)에 포함된 페이지 id 집합 */
  publishedPageIds: ReadonlySet<string>;
  /** site 메타의 pageId → icon (멘션 라벨 보강용, 선택) */
  pageIcons?: ReadonlyMap<string, string | null>;
};

/** icon/emoji 등 자산 스킴이 올 수 있는 attrs 키 */
const ASSET_ATTR_KEYS = ["src", "icon", "emoji"] as const;

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

function publicPageHref(token: string, pageId: string): string {
  return `/p/${token}?page=${pageId}`;
}

/** 유니코드 이모지만 라벨 앞에 붙인다(Lucide/이미지 ref 는 텍스트에 넣지 않음). */
function emojiPrefix(icon: string | null | undefined): string {
  if (!icon) return "";
  if (isImageLikePageIcon(icon) || decodeLucidePageIcon(icon)) return "";
  return `${icon} `;
}

function toPublicPageLinkText(
  targetId: string,
  label: string,
  ctx: PublicDocContext,
): JSONContent {
  if (!ctx.publishedPageIds.has(targetId)) {
    return { type: "text", text: label || "페이지" };
  }
  const icon = ctx.pageIcons?.get(targetId) ?? null;
  const text = `${emojiPrefix(icon)}${label || "페이지"}`;
  return {
    type: "text",
    text,
    marks: [{ type: "link", attrs: { href: publicPageHref(ctx.token, targetId) } }],
  };
}

function rewriteAssetAttrs(
  attrs: Record<string, unknown>,
  ctx: PublicDocContext,
): Record<string, unknown> | null {
  let changed = false;
  const next = { ...attrs };
  for (const key of ASSET_ATTR_KEYS) {
    const publicUrl = toPublicAssetUrl(attrs[key], ctx);
    if (publicUrl) {
      next[key] = publicUrl;
      changed = true;
    }
  }
  return changed ? next : null;
}

function transformNode(node: JSONContent, ctx: PublicDocContext): JSONContent {
  // 1차 미지원 블록 — 플레이스홀더로 치환
  if (node.type === "databaseBlock") {
    return placeholderParagraph("📊 인라인 데이터베이스 (공개 페이지에서는 표시되지 않습니다)");
  }
  if (node.type === "flowchartBlock") {
    return placeholderParagraph("🔀 플로우차트 (공개 페이지에서는 표시되지 않습니다)");
  }
  // 페이지 링크 — NodeView 가 로그인 store 를 전제하므로 링크 텍스트로 강등.
  if (node.type === "pageLink") {
    const targetId = typeof node.attrs?.id === "string" ? node.attrs.id : null;
    const label = typeof node.attrs?.label === "string" ? node.attrs.label : "페이지";
    if (!targetId) return { type: "text", text: label || "페이지" };
    return toPublicPageLinkText(targetId, label, ctx);
  }
  // 페이지 멘션 — 동일하게 공개 라우트 링크로 강등(클릭·아이콘 Cognito 경로 차단).
  if (node.type === "mention") {
    const rawId = typeof node.attrs?.id === "string" ? node.attrs.id : "";
    const kind = typeof node.attrs?.mentionKind === "string" ? node.attrs.mentionKind : null;
    const label = typeof node.attrs?.label === "string" ? node.attrs.label : "페이지";
    if (isPageMention(rawId, kind)) {
      return toPublicPageLinkText(stripPagePrefix(rawId), label, ctx);
    }
    // 멤버/DB 멘션은 텍스트만(클릭·프로필 팝업 비활성).
    return { type: "text", text: label ? `@${label}` : "@" };
  }

  let next = node;
  if (node.attrs && typeof node.attrs === "object") {
    const rewritten = rewriteAssetAttrs(
      node.attrs as Record<string, unknown>,
      ctx,
    );
    if (rewritten) next = { ...node, attrs: rewritten };
  }
  // tabBlock 등 자식 패널의 icon 도 재귀 처리
  if (!next.content?.length) return next;
  return { ...next, content: next.content.map((child) => transformNode(child, ctx)) };
}

/**
 * 공개 뷰어 렌더 직전 doc 변환. 원본을 변경하지 않고 새 트리를 반환한다.
 */
export function transformPublicDoc(
  doc: JSONContent,
  ctx: PublicDocContext,
): JSONContent {
  return transformNode(doc, ctx);
}
