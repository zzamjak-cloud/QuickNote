import type { JSONContent } from "@tiptap/react";
import {
  isLikelyUrlText,
  normalizeImportedLinkHref,
  summarizeImportedLinkText,
} from "./linkUtils";

function textNode(text: string): JSONContent {
  return { type: "text", text };
}

function paragraphNode(text: string): JSONContent {
  return {
    type: "paragraph",
    content: text ? parseInlineContent(text) : [],
  };
}

function headingNode(level: number, text: string): JSONContent {
  return {
    type: "heading",
    attrs: { level: Math.min(Math.max(level, 1), 6) },
    content: text ? parseInlineContent(text) : [],
  };
}

type ParsedListLine = {
  indent: number;
  kind: "bullet" | "ordered";
  text: string;
};

function parseListLine(line: string): ParsedListLine | null {
  if (/^\s*-\s+\[( |x|X)\]\s+/.test(line)) return null;
  const m = line.match(/^(\s*)(?:([-*])|(\d+)\.)\s+(.+)$/);
  if (!m) return null;
  const indent = m[1]?.length ?? 0;
  const kind = m[2] ? "bullet" : "ordered";
  const text = (m[4] ?? "").trim();
  return { indent, kind, text };
}

function parseNestedList(lines: string[], startIndex: number): { node: JSONContent; nextIndex: number } | null {
  const root = parseListLine(lines[startIndex] ?? "");
  if (!root) return null;

  type StackFrame = {
    indent: number;
    kind: "bullet" | "ordered";
    list: JSONContent;
    lastItem?: JSONContent;
  };

  const createList = (kind: "bullet" | "ordered"): JSONContent =>
    kind === "ordered"
      ? { type: "orderedList", attrs: { start: 1 }, content: [] }
      : { type: "bulletList", content: [] };

  const rootList = createList(root.kind);
  const stack: StackFrame[] = [{ indent: root.indent, kind: root.kind, list: rootList }];

  const addItem = (frame: StackFrame, text: string): JSONContent => {
    const item: JSONContent = {
      type: "listItem",
      content: [paragraphNode(text)],
    };
    frame.list.content = [...(frame.list.content ?? []), item];
    frame.lastItem = item;
    return item;
  };

  const firstFrame = stack[0];
  if (!firstFrame) return null;
  addItem(firstFrame, root.text);
  let i = startIndex + 1;

  while (i < lines.length) {
    const parsed = parseListLine(lines[i] ?? "");
    if (!parsed) break;
    const current = stack[stack.length - 1];
    if (!current) break;

    if (parsed.indent > current.indent) {
      const parentItem = current.lastItem;
      if (!parentItem) break;
      const childList = createList(parsed.kind);
      parentItem.content = [...(parentItem.content ?? []), childList];
      const childFrame: StackFrame = {
        indent: parsed.indent,
        kind: parsed.kind,
        list: childList,
      };
      stack.push(childFrame);
      addItem(childFrame, parsed.text);
      i += 1;
      continue;
    }

    while (stack.length > 1 && parsed.indent < (stack[stack.length - 1]?.indent ?? 0)) {
      stack.pop();
    }

    const target = stack[stack.length - 1];
    if (!target) break;
    if (parsed.indent !== target.indent) break;

    if (parsed.kind !== target.kind) {
      const parent = stack[stack.length - 2];
      if (parent?.lastItem) {
        const siblingList = createList(parsed.kind);
        parent.lastItem.content = [...(parent.lastItem.content ?? []), siblingList];
        const siblingFrame: StackFrame = {
          indent: parsed.indent,
          kind: parsed.kind,
          list: siblingList,
        };
        stack[stack.length - 1] = siblingFrame;
        addItem(siblingFrame, parsed.text);
      } else {
        break;
      }
    } else {
      addItem(target, parsed.text);
    }
    i += 1;
  }

  return { node: rootList, nextIndex: i };
}

function taskListNode(items: Array<{ checked: boolean; text: string }>): JSONContent {
  return {
    type: "taskList",
    content: items.map((item) => ({
      type: "taskItem",
      attrs: { checked: item.checked },
      content: [paragraphNode(item.text)],
    })),
  };
}

function blockquoteNode(lines: string[]): JSONContent {
  return {
    type: "blockquote",
    content: lines.map((line) => paragraphNode(line)),
  };
}

function codeBlockNode(language: string | null, code: string): JSONContent {
  return {
    type: "codeBlock",
    attrs: language ? { language } : {},
    content: code ? [textNode(code)] : [],
  };
}

function pushText(tokens: JSONContent[], text: string): void {
  if (!text) return;
  const urlRegex = /(https?:\/\/[^\s<>"')]+|www\.[^\s<>"')]+)/g;
  let last = 0;
  let match: RegExpExecArray | null = null;
  while ((match = urlRegex.exec(text)) !== null) {
    const start = match.index;
    const hit = match[0] ?? "";
    if (start > last) {
      tokens.push(textNode(text.slice(last, start)));
    }
    const normalized = normalizeImportedLinkHref(hit);
    if (normalized) {
      tokens.push({
        type: "text",
        text: summarizeImportedLinkText(hit),
        marks: [{ type: "link", attrs: { href: normalized, target: "_blank", rel: "noopener noreferrer nofollow" } }],
      });
    } else {
      tokens.push(textNode(hit));
    }
    last = start + hit.length;
  }
  if (last < text.length) {
    tokens.push(textNode(text.slice(last)));
  }
}

function parseInlineContent(text: string): JSONContent[] {
  const tokens: JSONContent[] = [];
  let rest = text;

  while (rest.length > 0) {
    const spanColor = rest.match(
      /<span[^>]*style=["'][^"']*color\s*:\s*([^;"']+)[^"']*["'][^>]*>(.*?)<\/span>/i,
    );
    const fontColor = rest.match(/<font[^>]*color=["']([^"']+)["'][^>]*>(.*?)<\/font>/i);
    const link = rest.match(/\[([^\]]+)\]\(([^)]+)\)/);
    const bold = rest.match(/\*\*([^*]+)\*\*/);
    const code = rest.match(/`([^`]+)`/);
    const italic = rest.match(/\*([^*]+)\*/);
    const candidates = [spanColor, fontColor, link, bold, code, italic]
      .filter((m): m is RegExpMatchArray => Boolean(m))
      .map((m) => ({ match: m, index: m.index ?? Number.MAX_SAFE_INTEGER }))
      .sort((a, b) => a.index - b.index);

    const next = candidates[0];
    if (!next) {
      pushText(tokens, rest);
      break;
    }

    const { match, index } = next;
    if (index > 0) {
      pushText(tokens, rest.slice(0, index));
    }

    if (match === spanColor) {
      const color = (spanColor?.[1] ?? "").trim();
      const coloredText = spanColor?.[2] ?? "";
      if (coloredText) {
        tokens.push({
          type: "text",
          text: coloredText,
          marks: [{ type: "textStyle", attrs: { color } }],
        });
      }
    } else if (match === fontColor) {
      const color = (fontColor?.[1] ?? "").trim();
      const coloredText = fontColor?.[2] ?? "";
      if (coloredText) {
        tokens.push({
          type: "text",
          text: coloredText,
          marks: [{ type: "textStyle", attrs: { color } }],
        });
      }
    } else if (match === link) {
      const label = link?.[1] ?? "";
      const href = link?.[2] ?? "";
      const normalizedHref = normalizeImportedLinkHref(href);
      if (normalizedHref) {
        const outputLabel = isLikelyUrlText(label) ? summarizeImportedLinkText(label) : label;
        tokens.push({
          type: "text",
          text: outputLabel,
          marks: [{ type: "link", attrs: { href: normalizedHref, target: "_blank", rel: "noopener noreferrer nofollow" } }],
        });
      } else {
        tokens.push({
          type: "text",
          text: label,
        });
      }
    } else if (match === bold) {
      tokens.push({
        type: "text",
        text: bold?.[1] ?? "",
        marks: [{ type: "bold" }],
      });
    } else if (match === code) {
      tokens.push({
        type: "text",
        text: code?.[1] ?? "",
        marks: [{ type: "code" }],
      });
    } else if (match === italic) {
      tokens.push({
        type: "text",
        text: italic?.[1] ?? "",
        marks: [{ type: "italic" }],
      });
    }

    rest = rest.slice(index + match[0].length);
  }

  return tokens;
}

function extractAsideText(raw: string): string {
  return raw
    .replace(/<img[^>]*>/gi, "")
    .replace(/<\/?aside[^>]*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function calloutNode(text: string): JSONContent {
  return {
    type: "callout",
    attrs: { preset: "info" },
    content: text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => paragraphNode(line)),
  };
}

function stripLeadingTitle(markdown: string, title: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length && !lines[i]?.trim()) i += 1;
  const first = lines[i]?.trim() ?? "";
  const normalizedTitle = title.trim();
  if (first === `# ${normalizedTitle}` || first === normalizedTitle) {
    lines.splice(i, 1);
    if (lines[i]?.trim() === "") lines.splice(i, 1);
  }
  return lines.join("\n");
}

// 표 본문/헤더 라인 형태(파이프 포함)인지 판정
function isTableRowLine(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line);
}

// 구분선(|---|:--:|---| 등) 형태인지 판정
function isTableDelimiterLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("-")) return false;
  // 셀마다 :?-+:? 형태여야 하며 파이프 구분 필요
  return /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(trimmed);
}

// 한 라인을 셀 배열로 분리. escape 된 \| 는 셀 내용으로 보존
function splitTableRow(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  // 앞뒤 공백 제거 후 처리
  const s = line.trim();
  for (let idx = 0; idx < s.length; idx += 1) {
    const ch = s[idx];
    if (ch === "\\" && s[idx + 1] === "|") {
      // escape 된 파이프는 셀 내용으로 살린다
      cur += "|";
      idx += 1;
      continue;
    }
    if (ch === "|") {
      cells.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  // 앞뒤 빈 셀(leading/trailing 파이프로 생긴 것) 제거
  if (cells.length > 0 && cells[0]?.trim() === "") cells.shift();
  if (cells.length > 0 && cells[cells.length - 1]?.trim() === "") cells.pop();
  return cells.map((c) => c.trim());
}

// 셀 1개를 tableHeader/tableCell 노드로. htmlToDoc.tableFromElement 와 동일 구조
function tableCellNode(text: string, isHeader: boolean): JSONContent {
  const inline = text ? parseInlineContent(text) : [];
  const paragraph: JSONContent = {
    type: "paragraph",
    content: inline.length > 0 ? inline : [],
  };
  return {
    type: isHeader ? "tableHeader" : "tableCell",
    content: [paragraph],
  };
}

// 헤더 라인 + 구분선 + 본문 라인들을 table JSONContent 로 변환
function buildTableNode(headerLine: string, bodyLines: string[]): JSONContent {
  const headerCells = splitTableRow(headerLine);
  const colCount = headerCells.length;
  const rows: JSONContent[] = [];

  // 헤더 행
  rows.push({
    type: "tableRow",
    content: headerCells.map((cell) => tableCellNode(cell, true)),
  });

  // 본문 행: 헤더 열 수에 맞춰 부족분 빈 셀 채우고 초과분 버림
  bodyLines.forEach((bodyLine) => {
    const cells = splitTableRow(bodyLine);
    const normalized: string[] = [];
    for (let c = 0; c < colCount; c += 1) {
      normalized.push(cells[c] ?? "");
    }
    rows.push({
      type: "tableRow",
      content: normalized.map((cell) => tableCellNode(cell, false)),
    });
  });

  return {
    type: "table",
    content: rows.length > 0 ? rows : [{ type: "tableRow", content: [] }],
  };
}

export function notionMarkdownToDoc(markdown: string, options?: { pageTitle?: string }): JSONContent {
  const normalizedMarkdown = options?.pageTitle
    ? stripLeadingTitle(markdown, options.pageTitle)
    : markdown;
  const lines = normalizedMarkdown.replace(/\r\n/g, "\n").split("\n");
  const content: JSONContent[] = [];

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i] ?? "";
    const line = raw.trimEnd();

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const levelToken = headingMatch[1] ?? "#";
      const headingText = headingMatch[2] ?? "";
      content.push(headingNode(levelToken.length, headingText.trim()));
      i += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      content.push({ type: "horizontalRule" });
      i += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const language = line.slice(3).trim() || null;
      i += 1;
      const codeLines: string[] = [];
      while (i < lines.length) {
        const codeLine = lines[i] ?? "";
        if (codeLine.trimStart().startsWith("```")) break;
        codeLines.push(codeLine);
        i += 1;
      }
      if (i < lines.length) i += 1;
      content.push(codeBlockNode(language, codeLines.join("\n")));
      continue;
    }

    if (line.toLowerCase().startsWith("<aside")) {
      const asideLines: string[] = [line];
      i += 1;
      while (i < lines.length) {
        const cur = lines[i] ?? "";
        asideLines.push(cur);
        i += 1;
        if (cur.toLowerCase().includes("</aside>")) break;
      }
      const plainText = extractAsideText(asideLines.join("\n"));
      if (plainText) content.push(calloutNode(plainText));
      continue;
    }

    if (line.trimStart().startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length) {
        const quoteLine = lines[i] ?? "";
        if (!quoteLine.trimStart().startsWith(">")) break;
        const q = quoteLine.trimStart().replace(/^>\s?/, "");
        quoteLines.push(q);
        i += 1;
      }
      content.push(blockquoteNode(quoteLines));
      continue;
    }

    if (/^- \[( |x|X)\]\s+/.test(line.trimStart())) {
      const tasks: Array<{ checked: boolean; text: string }> = [];
      while (i < lines.length) {
        const cur = (lines[i] ?? "").trimStart();
        const m = cur.match(/^- \[( |x|X)\]\s+(.+)$/);
        if (!m) break;
        const checkedToken = (m[1] ?? " ").toLowerCase();
        const taskText = m[2] ?? "";
        tasks.push({ checked: checkedToken === "x", text: taskText.trim() });
        i += 1;
      }
      content.push(taskListNode(tasks));
      continue;
    }

    // GFM 표: 현재 라인이 파이프 행이고 다음 라인이 구분선이면 표로 변환
    if (isTableRowLine(line) && isTableDelimiterLine(lines[i + 1] ?? "")) {
      const headerLine = line;
      i += 2; // 헤더 + 구분선 소비
      const bodyLines: string[] = [];
      while (i < lines.length) {
        const cur = (lines[i] ?? "").trimEnd();
        if (!isTableRowLine(cur)) break;
        bodyLines.push(cur);
        i += 1;
      }
      content.push(buildTableNode(headerLine, bodyLines));
      continue;
    }

    const nestedList = parseNestedList(lines, i);
    if (nestedList) {
      content.push(nestedList.node);
      i = nestedList.nextIndex;
      continue;
    }

    const paragraphLines: string[] = [];
    while (i < lines.length) {
      const curLine = lines[i] ?? "";
      const cur = curLine.trimEnd();
      if (!cur.trim()) break;
      if (/^(#{1,6})\s+/.test(cur)) break;
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(cur.trim())) break;
      if (cur.trimStart().startsWith("```")) break;
      if (cur.trimStart().startsWith(">")) break;
      if (/^-\s+/.test(cur.trimStart())) break;
      if (/^\d+\.\s+/.test(cur.trimStart())) break;
      paragraphLines.push(cur.trim());
      i += 1;
    }
    content.push(paragraphNode(paragraphLines.join(" ")));
  }

  return {
    type: "doc",
    content: content.length > 0 ? content : [paragraphNode("")],
  };
}
