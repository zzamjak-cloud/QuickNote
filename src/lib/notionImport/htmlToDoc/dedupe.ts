import type { JSONContent } from "@tiptap/react";

export function blockFingerprint(node: JSONContent): string | null {
  if (node.type === "image") {
    return `image:${String(node.attrs?.src ?? "")}`;
  }
  if (node.type === "bookmarkBlock") {
    return `bookmark:${String(node.attrs?.href ?? "")}:${String(node.attrs?.imageUrl ?? "")}`;
  }
  if (node.type === "paragraph" && Array.isArray(node.content) && node.content.length === 1) {
    const child = node.content[0];
    if (child?.type === "mention") {
      return `mention:${String(child.attrs?.id ?? "")}:${String(child.attrs?.label ?? "")}`;
    }
  }
  return null;
}

export function dedupeConsecutiveImportBlocks(input: JSONContent[]): JSONContent[] {
  const out: JSONContent[] = [];
  let prevKey: string | null = null;
  for (const block of input) {
    const key = blockFingerprint(block);
    if (key && key === prevKey) continue;
    out.push(block);
    prevKey = key;
  }
  return out;
}
