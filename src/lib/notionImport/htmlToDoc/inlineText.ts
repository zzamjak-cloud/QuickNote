import type { JSONContent } from "@tiptap/react";
import {
  normalizeImportedLinkHref,
  summarizeImportedLinkText,
} from "../linkUtils";
import { textNode, mergeMarks } from "./nodes";

export function textNodesWithAutoLinks(
  raw: string,
  baseMarks: NonNullable<JSONContent["marks"]>,
): JSONContent[] {
  const urlRegex = /(https?:\/\/[^\s<>"')]+|www\.[^\s<>"')]+)/g;
  const out: JSONContent[] = [];
  let last = 0;
  let match: RegExpExecArray | null = null;
  while ((match = urlRegex.exec(raw)) !== null) {
    const start = match.index;
    const hit = match[0] ?? "";
    if (start > last) {
      out.push(textNode(raw.slice(last, start), baseMarks.length > 0 ? baseMarks : undefined));
    }
    const normalized = normalizeImportedLinkHref(hit);
    if (normalized) {
      out.push(
        textNode(
          summarizeImportedLinkText(hit),
          mergeMarks(baseMarks, [{ type: "link", attrs: { href: normalized, target: "_blank", rel: "noopener noreferrer nofollow" } }]),
        ),
      );
    } else {
      out.push(textNode(hit, baseMarks.length > 0 ? baseMarks : undefined));
    }
    last = start + hit.length;
  }
  if (last < raw.length) {
    out.push(textNode(raw.slice(last), baseMarks.length > 0 ? baseMarks : undefined));
  }
  return out.length > 0 ? out : [textNode(raw, baseMarks.length > 0 ? baseMarks : undefined)];
}
