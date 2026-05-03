import type { JSONContent } from "@tiptap/react";

/** 로컬 저장용으로 blob: URL 은 세션 이후 무효 → 로드 시 안전하게 치환 */
export function stripStaleBlobImages(doc: JSONContent): JSONContent {
  return walk(doc);
}

function walk(node: JSONContent): JSONContent {
  if (
    node.type === "image" &&
    typeof node.attrs?.src === "string" &&
    node.attrs.src.startsWith("blob:")
  ) {
    return {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "⚠️ 이전에 삽입된 이미지(blob)는 새로고침 후 만료됩니다. 이미지를 다시 넣어 주세요.",
        },
      ],
    };
  }
  if (!node.content?.length) {
    return node;
  }
  return {
    ...node,
    content: node.content.map(walk),
  };
}
