import type { JSONContent } from "@tiptap/react";
import { newId } from "../id";
import type { Member } from "../../store/memberStore";
import { resolveImportedPersonMemberId } from "./personName";

export type NotionInlineComment = {
  authorName: string;
  bodyText: string;
  blockText: string;
};

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function extractNotionInlineComments(html: string | Document): NotionInlineComment[] {
  if (typeof html === "string" && typeof DOMParser === "undefined") return [];
  const doc = typeof html === "string"
    ? new DOMParser().parseFromString(html, "text/html")
    : html;
  const detailsNodes = Array.from(doc.querySelectorAll("details"));
  const detail = detailsNodes.find((node) => {
    const summary = node.querySelector("summary");
    return normalizeText(summary?.textContent ?? "") === "인라인 댓글";
  });
  if (!detail) return [];

  const out: NotionInlineComment[] = [];
  const threads = Array.from(detail.querySelectorAll(":scope > .indented, .indented"));
  for (const thread of threads) {
    if (!(thread instanceof HTMLElement)) continue;
    const blockLabel = thread.querySelector("p");
    const blockText = normalizeText(blockLabel?.textContent ?? "")
      .replace(/^블록 텍스트\s*:\s*/, "")
      .trim();
    const items = Array.from(thread.querySelectorAll("ul.toggle > li"));
    for (const item of items) {
      if (!(item instanceof HTMLElement)) continue;
      const author = normalizeText(item.querySelector(".user b")?.textContent ?? "");
      const bodyDivs = Array.from(item.querySelectorAll(":scope > div"))
        .filter((div) => !(div.querySelector(".user")))
        .map((div) => normalizeText(div.textContent ?? ""))
        .filter((text) => text.length > 0);
      const bodyText = bodyDivs[0] ?? "";
      if (!bodyText) continue;
      out.push({
        authorName: author || "Notion 사용자",
        bodyText,
        blockText,
      });
    }
  }
  return out;
}

const COMMENT_ANCHOR_NODE_TYPES = new Set([
  "paragraph",
  "heading",
  "listItem",
  "taskItem",
  "codeBlock",
  "blockquote",
  "callout",
  "toggleHeader",
  "tableCell",
  "tableHeader",
]);

function normalizeForMatch(value: string): string {
  return value
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function tokenizeForMatch(value: string): string[] {
  return normalizeForMatch(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function tokenOverlapScore(a: string, b: string): number {
  const ta = new Set(tokenizeForMatch(a));
  const tb = new Set(tokenizeForMatch(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) {
    if (tb.has(t)) inter += 1;
  }
  return inter / Math.max(ta.size, tb.size);
}

function collectText(node: { text?: string; content?: Array<unknown> } | null | undefined): string {
  if (!node || typeof node !== "object") return "";
  let out = typeof node.text === "string" ? node.text : "";
  const content = (node as { content?: Array<unknown> }).content;
  if (Array.isArray(content)) {
    for (const child of content) {
      out += ` ${collectText(child as { text?: string; content?: Array<unknown> })}`;
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

export function resolveNotionCommentBlockId(
  doc: { content?: Array<unknown> } | null | undefined,
  blockText: string,
): string | null {
  const needle = normalizeForMatch(blockText);
  if (!needle || !doc || !Array.isArray(doc.content)) return null;
  let bestId: string | null = null;
  let bestScore = 0;

  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as {
      type?: string;
      attrs?: { id?: unknown };
      content?: Array<unknown>;
      text?: string;
    };
    const id = typeof n.attrs?.id === "string" ? n.attrs.id : null;
    if (id && n.type && COMMENT_ANCHOR_NODE_TYPES.has(n.type)) {
      const raw = collectText(n);
      const hay = normalizeForMatch(raw);
      if (hay) {
        const exact = hay === needle;
        const includes = hay.includes(needle) || needle.includes(hay);
        const overlap = tokenOverlapScore(hay, needle);
        const score = exact ? 3 : includes ? 2 : overlap >= 0.5 ? 1.5 : overlap >= 0.34 ? 1 : 0;
        if (score > bestScore) {
          bestScore = score;
          bestId = id;
        }
      }
    }
    if (Array.isArray(n.content)) {
      n.content.forEach(walk);
    }
  };

  doc.content.forEach(walk);
  return bestScore > 0 ? bestId : null;
}

export function ensureCommentAnchorBlockIds(
  doc: JSONContent | null | undefined,
): JSONContent {
  const safeDoc: JSONContent = doc ?? { type: "doc", content: [] };
  const walk = (node: JSONContent): JSONContent => {
    const next: JSONContent = { ...node };
    if (node.type && COMMENT_ANCHOR_NODE_TYPES.has(node.type)) {
      const attrs = { ...(node.attrs ?? {}) } as Record<string, unknown>;
      if (typeof attrs.id !== "string" || attrs.id.length === 0) {
        attrs.id = `blk-${newId()}`;
      }
      next.attrs = attrs;
    }
    if (Array.isArray(node.content)) {
      next.content = node.content.map((child) => walk(child));
    }
    return next;
  };
  return walk(safeDoc);
}

export function resolveImportedCommentAuthorMemberId(
  authorName: string,
  members: Member[],
  fallbackMemberId: string,
): string {
  return resolveImportedPersonMemberId(authorName, members, fallbackMemberId);
}
