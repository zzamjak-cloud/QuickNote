// 본문 평문 추출·스니펫 — src/lib/search/tiptapText 와 같은 규칙(텍스트 노드 재귀 수집).
// src 쪽 모듈은 @tiptap 타입을 import 하므로 infra 번들 규약(런타임·타입 npm import 금지)에 맞춰 여기서 다시 둔다.
import type { DocNode } from "../../../src/lib/docModel/types";

const SNIPPET_BEFORE = 40;
const SNIPPET_AFTER = 100;

export function collectNodeText(node: DocNode): string {
  if (typeof node.text === "string") return node.text;
  if (!node.content?.length) return "";
  return node.content.map(collectNodeText).join("");
}

/** Pages.doc(문자열 또는 객체) → doc 노드. 파싱 불가면 null. */
export function parseDocJson(value: unknown): DocNode | null {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const node = parsed as DocNode;
  return node.type === "doc" ? node : null;
}

/** 최상위 블록별 평문(빈 블록 제외). */
export function blockTexts(doc: DocNode | null): string[] {
  return (doc?.content ?? []).map((n) => collectNodeText(n).trim()).filter(Boolean);
}

export function normalizeForMatch(text: string): string {
  return text.normalize("NFC").toLowerCase();
}

/** 첫 매치 블록 주변 스니펫. 매치 없으면 null. */
export function findSnippet(texts: string[], queryNorm: string): string | null {
  for (const raw of texts) {
    const text = raw.normalize("NFC");
    const index = text.toLowerCase().indexOf(queryNorm);
    if (index < 0) continue;
    const start = Math.max(0, index - SNIPPET_BEFORE);
    const end = Math.min(text.length, index + queryNorm.length + SNIPPET_AFTER);
    return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
  }
  return null;
}
