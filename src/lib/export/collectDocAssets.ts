import type { JSONContent } from "@tiptap/react";
import { isImageRef } from "../sync/imageScheme";
import { isFileRef } from "../files/scheme";

/**
 * doc 트리를 순회해 zip 으로 묶어야 할 자산 ref 를 수집한다.
 * - image 노드 src 중 quicknote-image:// ref
 * - fileBlock 노드 src 중 quicknote-file:// ref
 * - galleryBlock data.images[].src 의 quicknote 자산 ref
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
    if (node.type === "galleryBlock") {
      let galleryData: unknown = node.attrs?.data;
      for (let i = 0; i < 2 && typeof galleryData === "string"; i += 1) {
        try {
          galleryData = JSON.parse(galleryData) as unknown;
        } catch {
          galleryData = null;
        }
      }
      if (galleryData && typeof galleryData === "object" && !Array.isArray(galleryData)) {
        const images = (galleryData as Record<string, unknown>).images;
        if (Array.isArray(images)) {
          for (const image of images) {
            if (!image || typeof image !== "object" || Array.isArray(image)) continue;
            add((image as Record<string, unknown>).src);
          }
        }
      }
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc);
  return refs;
}
