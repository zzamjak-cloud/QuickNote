import type { JSONContent } from "@tiptap/react";

export function codeBlockFromElement(pre: HTMLElement): JSONContent {
  const codeEl = pre.querySelector("code");
  const rawText = (codeEl?.textContent ?? pre.textContent ?? "").replace(/\r\n/g, "\n");
  const languageClass = (codeEl?.className ?? pre.className)
    .split(/\s+/)
    .find((cls) => cls.startsWith("language-"));
  const language = languageClass?.replace(/^language-/, "") || null;
  return {
    type: "codeBlock",
    attrs: language ? { language } : undefined,
    content: rawText.length > 0 ? [{ type: "text", text: rawText }] : [],
  };
}
