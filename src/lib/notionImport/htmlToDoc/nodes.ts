import type { JSONContent } from "@tiptap/react";

export function textNode(text: string, marks?: JSONContent["marks"]): JSONContent {
  return marks && marks.length > 0 ? { type: "text", text, marks } : { type: "text", text };
}

export function mergeMarks(base: NonNullable<JSONContent["marks"]>, extra: NonNullable<JSONContent["marks"]>): NonNullable<JSONContent["marks"]> {
  const out = [...base];
  for (const mark of extra) {
    const exists = out.some((m) => m.type === mark.type && JSON.stringify(m.attrs ?? {}) === JSON.stringify(mark.attrs ?? {}));
    if (!exists) out.push(mark);
  }
  return out;
}

// Notion 은 이미지 캡션을 <figure class="image"><img/><figcaption>캡션</figcaption></figure>
// 로 내보낸다. 이미지를 감싸는 figure 의 figcaption 텍스트를 추출한다.
export function figcaptionTextForImage(img: HTMLElement): string | null {
  const figure = img.closest("figure");
  if (!figure) return null;
  const caption = figure.querySelector(":scope > figcaption");
  const text = (caption?.textContent ?? "").trim();
  return text.length > 0 ? text : null;
}

// 캡션 텍스트를 image/video 노드 attrs 에 병합. fileBlock 등은 캡션 미지원이라 그대로 둔다.
export function withCaption(node: JSONContent, caption: string | null): JSONContent {
  if (!caption || (node.type !== "image" && node.type !== "video")) return node;
  return { ...node, attrs: { ...(node.attrs ?? {}), caption } };
}
