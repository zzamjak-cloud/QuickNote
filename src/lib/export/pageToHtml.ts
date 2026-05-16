import type { JSONContent } from "@tiptap/react";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineToHtml(node: JSONContent): string {
  if (node.type === "text") {
    let text = escapeHtml(node.text ?? "");
    const marks = node.marks ?? [];
    for (const mark of marks) {
      if (mark.type === "bold") text = `<strong>${text}</strong>`;
      else if (mark.type === "italic") text = `<em>${text}</em>`;
      else if (mark.type === "code") text = `<code>${text}</code>`;
      else if (mark.type === "strike") text = `<s>${text}</s>`;
      else if (mark.type === "link") text = `<a href="${escapeHtml(mark.attrs?.href ?? "")}">${text}</a>`;
    }
    return text;
  }
  if (node.type === "hardBreak") return "<br>";
  return "";
}

function nodeToHtml(node: JSONContent, depth = 0): string {
  if (!node) return "";

  switch (node.type) {
    case "doc":
      return (node.content ?? []).map((n) => nodeToHtml(n, depth)).join("\n");
    case "paragraph": {
      const inner = (node.content ?? []).map(inlineToHtml).join("");
      return inner ? `<p>${inner}</p>` : "<p></p>";
    }
    case "heading": {
      const level = (node.attrs?.level as number) ?? 1;
      const inner = (node.content ?? []).map(inlineToHtml).join("");
      return `<h${level}>${inner}</h${level}>`;
    }
    case "bulletList":
      return `<ul>\n${(node.content ?? []).map((n) => nodeToHtml(n, depth)).join("\n")}\n</ul>`;
    case "orderedList":
      return `<ol>\n${(node.content ?? []).map((n) => nodeToHtml(n, depth)).join("\n")}\n</ol>`;
    case "listItem": {
      const inner = (node.content ?? []).map((n) => nodeToHtml(n, depth + 1)).join("");
      return `<li>${inner}</li>`;
    }
    case "blockquote":
      return `<blockquote>${(node.content ?? []).map((n) => nodeToHtml(n, depth)).join("\n")}</blockquote>`;
    case "codeBlock": {
      const lang = node.attrs?.language ?? "";
      const code = (node.content ?? []).map((n) => escapeHtml(n.text ?? "")).join("");
      return `<pre><code${lang ? ` class="language-${lang}"` : ""}>${code}</code></pre>`;
    }
    case "horizontalRule":
      return "<hr>";
    case "image":
      return `<img src="${escapeHtml(node.attrs?.src ?? "")}" alt="${escapeHtml(node.attrs?.alt ?? "")}" />`;
    default:
      return (node.content ?? []).map((n) => nodeToHtml(n, depth)).join("");
  }
}

export function pageDocToHtml(title: string, doc: JSONContent | null | undefined): string {
  const body = doc ? nodeToHtml(doc) : "";
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1.5rem; line-height: 1.7; color: #1a1a1a; }
    h1, h2, h3, h4, h5, h6 { margin-top: 1.5em; margin-bottom: 0.5em; }
    p { margin: 0.75em 0; }
    pre { background: #f4f4f4; border-radius: 6px; padding: 1em; overflow-x: auto; }
    code { font-family: 'Fira Code', monospace; font-size: 0.9em; background: #f4f4f4; padding: 0.1em 0.3em; border-radius: 3px; }
    pre code { background: none; padding: 0; }
    blockquote { border-left: 4px solid #d1d5db; margin: 1em 0; padding-left: 1em; color: #6b7280; }
    a { color: #2563eb; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 1.5em 0; }
    ul, ol { padding-left: 1.5em; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title || "제목 없음")}</h1>
  ${body}
</body>
</html>`;
}
