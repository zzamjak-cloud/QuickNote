import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import { DOMSerializer } from "@tiptap/pm/model";

async function writeClipboard(html: string, text: string): Promise<void> {
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      return;
    }
  } catch {
    /* ClipboardItem 미지원/거부 — 텍스트 폴백 */
  }
  try {
    await navigator.clipboard?.writeText(text);
  } catch {
    /* 클립보드 권한 거부 — 조용히 무시 */
  }
}

/**
 * 블록 노드들을 schema 직렬화 HTML(text/html) + 평문(text/plain)으로 클립보드에 싣는다.
 * 에디터에 붙여넣으면 PM 이 HTML 을 파싱해 블록이 그대로 재구성된다.
 * 박스 선택 복사/잘라내기와 이미지 노드 잘라내기가 공유한다.
 */
export function writeBlocksToClipboard(nodes: PMNode[], schema: Schema): void {
  if (nodes.length === 0) return;
  const serializer = DOMSerializer.fromSchema(schema);
  const container = document.createElement("div");
  for (const node of nodes) {
    container.appendChild(serializer.serializeNode(node));
  }
  const text = nodes
    .map((node) => node.textBetween(0, node.content.size, "\n"))
    .join("\n");
  void writeClipboard(container.innerHTML, text);
}
