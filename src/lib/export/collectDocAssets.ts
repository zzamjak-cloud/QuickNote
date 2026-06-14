import type { JSONContent } from "@tiptap/react";
import { isImageRef } from "../sync/imageScheme";
import { isFileRef } from "../files/scheme";

/**
 * doc 트리를 순회해 zip 으로 묶어야 할 자산 ref 를 수집한다.
 * - image 노드 src 중 quicknote-image:// ref
 * - fileBlock 노드 src 중 quicknote-file:// ref
 * 중복은 제거하며 등장 순서를 유지한다.
 */
export function collectDocAssetRefs(doc: JSONContent | null | undefined): string[] {
  if (!doc) return [];
  const refs: string[] = [];
  const seen = new Set<string>();
  const add = (ref: unknown): void => {
    if (typeof ref !== "string" || seen.has(ref)) return;
    if (isImageRef(ref) || isFileRef(ref)) {
      seen.add(ref);
      refs.push(ref);
    }
  };
  const walk = (node: JSONContent): void => {
    if (!node) return;
    if (node.type === "image" || node.type === "fileBlock") {
      add(node.attrs?.src);
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc);
  return refs;
}
