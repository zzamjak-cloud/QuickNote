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
  // 인라인 버튼(buttonBlock)은 라벨 텍스트 링크로 직렬화 — 노션 import 는 단일 anchor 문단을
  // 북마크/링크로 인식한다. href 가 없으면 라벨 텍스트만 남긴다.
  if (node.type === "buttonBlock") {
    const label = escapeHtml((node.attrs?.label as string) ?? "버튼");
    const href = (node.attrs?.href as string) ?? "";
    return href ? `<a href="${escapeHtml(href)}">${label}</a>` : label;
  }
  return "";
}

// toggleHeader/tabPanel 등 인라인 자식만 가진 노드의 텍스트를 추출.
function inlineChildrenToHtml(node: JSONContent): string {
  return (node.content ?? []).map(inlineToHtml).join("");
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
    case "image": {
      const src = escapeHtml(node.attrs?.src ?? "");
      const alt = escapeHtml(node.attrs?.alt ?? "");
      const caption = (node.attrs?.caption as string) ?? "";
      // 캡션이 있으면 노션 export 와 동일한 figure.image + figcaption 구조 — 파서가 캡션을 복원.
      if (caption) {
        return `<figure class="image"><img src="${src}" alt="${alt}" /><figcaption>${escapeHtml(caption)}</figcaption></figure>`;
      }
      return `<img src="${src}" alt="${alt}" />`;
    }
    case "callout": {
      // 노션 export 의 콜아웃 = <aside> — 파서 calloutFromAside 가 자식 블록을 본문으로 복원.
      // 아이콘(이모지)은 data-emoji 로 함께 내보내 라운드트립 시 의미 손실을 최소화한다.
      const inner = (node.content ?? []).map((n) => nodeToHtml(n, depth)).join("\n");
      const emoji = (node.attrs?.emoji as string | null) ?? null;
      const emojiAttr = emoji ? ` data-emoji="${escapeHtml(emoji)}"` : "";
      return `<aside${emojiAttr}>\n${inner}\n</aside>`;
    }
    case "toggle": {
      // <details><summary>제목</summary>…내용…</details> — 파서 toggleFromDetails 가 복원.
      const header = (node.content ?? []).find((n) => n.type === "toggleHeader");
      const body = (node.content ?? []).find((n) => n.type === "toggleContent");
      const summary = header ? inlineChildrenToHtml(header) : "";
      const open = node.attrs?.open ? " open" : "";
      const bodyHtml = (body?.content ?? []).map((n) => nodeToHtml(n, depth)).join("\n");
      return `<details${open}><summary>${summary}</summary>\n${bodyHtml}\n</details>`;
    }
    case "toggleHeader":
      return inlineChildrenToHtml(node);
    case "toggleContent":
      return (node.content ?? []).map((n) => nodeToHtml(n, depth)).join("\n");
    case "columnLayout": {
      // div.column-list > div.column — 파서 columnLayoutBlocksFromColumnList 가 복원(2~4열).
      const columns = (node.content ?? [])
        .filter((n) => n.type === "column")
        .map((col) => {
          const colInner = (col.content ?? []).map((n) => nodeToHtml(n, depth)).join("\n");
          return `<div class="column">\n${colInner}\n</div>`;
        })
        .join("\n");
      return `<div class="column-list">\n${columns}\n</div>`;
    }
    case "column":
      return (node.content ?? []).map((n) => nodeToHtml(n, depth)).join("\n");
    case "bookmarkBlock": {
      // 노션 북마크 구조 — figure.bookmark > a[href] > (.bookmark-title/.bookmark-description/.bookmark-href).
      // 파서 bookmarkBlockFromAnchor 가 이 클래스들을 읽어 href/title/description/siteName 을 복원.
      const href = escapeHtml(node.attrs?.href ?? "");
      const title = escapeHtml((node.attrs?.title as string) ?? "");
      const description = (node.attrs?.description as string) ?? "";
      const siteName = (node.attrs?.siteName as string) ?? "";
      const imageUrl = (node.attrs?.imageUrl as string) ?? "";
      const parts = [`<div class="bookmark-title">${title}</div>`];
      if (description) parts.push(`<div class="bookmark-description">${escapeHtml(description)}</div>`);
      if (siteName) parts.push(`<div class="bookmark-href">${escapeHtml(siteName)}</div>`);
      if (imageUrl) parts.push(`<img class="bookmark-image" src="${escapeHtml(imageUrl)}" alt="" />`);
      return `<figure class="bookmark"><a href="${href}">${parts.join("")}</a></figure>`;
    }
    case "youtube": {
      // <figure><iframe src="embed url"> — 파서 youtubeNodeFromElement 가 videoId 를 복원.
      const src = (node.attrs?.src as string) ?? "";
      return `<figure><iframe src="${escapeHtml(src)}"></iframe></figure>`;
    }
    case "fileBlock": {
      // 파서는 파일을 자산 리졸버로만 fileBlock 화하므로 라운드트립이 보장되지 않는다.
      // 데이터 누출 없이 최소한 다운로드 링크로 보존한다(노션 import 시 링크 문단).
      const src = (node.attrs?.src as string) ?? "";
      const name = (node.attrs?.name as string) ?? "파일";
      return `<p><a href="${escapeHtml(src)}">${escapeHtml(name)}</a></p>`;
    }
    case "tabBlock": {
      // 파서는 탭을 인식하지 않으므로, 각 패널을 제목(h3) + 내용 섹션으로 펼친다.
      return (node.content ?? [])
        .filter((n) => n.type === "tabPanel")
        .map((panel) => nodeToHtml(panel, depth))
        .join("\n");
    }
    case "tabPanel": {
      const title = (node.attrs?.title as string) ?? "탭";
      const inner = (node.content ?? []).map((n) => nodeToHtml(n, depth)).join("\n");
      return `<h3>${escapeHtml(title)}</h3>\n${inner}`;
    }
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
