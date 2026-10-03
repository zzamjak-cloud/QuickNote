// TipTap 인라인 노드 배열 → QFM 인라인 문자열.
import type { DocMark, DocNode } from "../types";
import {
  resolveMentionKindAttr,
  stripDatabasePrefix,
  stripMemberPrefix,
  stripPagePrefix,
} from "../../tiptapExtensions/mentionKind";
import { ATTR_TAG_BY_TYPE, formatAttrTag } from "./nodeSpecs";
import { escapeAttr, escapeLabel, escapeText, isAlnum, isWhitespace } from "./textEscape";

export type InlineOptions = {
  /** hardBreak 표현 — 문단은 줄바꿈, 제목·표 셀·토글 제목은 <br> */
  breakMode: "newline" | "br";
  inTable?: boolean;
};

// 바깥 → 안쪽 직렬화 순서 (code 는 리프에서 별도 처리)
const MARK_ORDER = ["link", "textStyle", "highlight", "underline", "bold", "italic", "strike"];

type OpenMark = { mark: DocMark; close: string };

function markColor(mark: DocMark): string | null {
  const color = mark.attrs?.color;
  return typeof color === "string" && color ? color : null;
}

function isRenderableMark(mark: DocMark): boolean {
  if (!MARK_ORDER.includes(mark.type)) return false;
  if (mark.type === "textStyle") return markColor(mark) !== null;
  if (mark.type === "link") return typeof mark.attrs?.href === "string" && mark.attrs.href !== "";
  return true;
}

function sortedMarks(node: DocNode): DocMark[] {
  return (node.marks ?? [])
    .filter(isRenderableMark)
    .sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type));
}

function sameMark(a: DocMark, b: DocMark): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "link") return a.attrs?.href === b.attrs?.href;
  if (a.type === "textStyle" || a.type === "highlight") return markColor(a) === markColor(b);
  return true;
}

function hasCode(node: DocNode): boolean {
  return (node.marks ?? []).some((m) => m.type === "code");
}

function formatHref(href: string): string {
  if (!/[\s()<>]/.test(href)) return href;
  return `<${href.replace(/</g, "%3C").replace(/>/g, "%3E")}>`;
}

function codeSpan(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length));
  const fence = "`".repeat(longest + 1);
  // 파서가 양끝 공백 1칸을 벗겨내므로, 백틱 또는 양끝 공백이면 한 칸씩 덧댄다
  const spaced = text.startsWith(" ") && text.endsWith(" ") && text.trim() !== "";
  const pad = text.startsWith("`") || text.endsWith("`") || spaced ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

/** 강조(이탤릭) 구간 판정용 원문 텍스트 */
function rawText(node: DocNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  return "<";
}

function mentionTag(node: DocNode): string {
  const rawId = typeof node.attrs?.id === "string" ? node.attrs.id : "";
  const label = typeof node.attrs?.label === "string" ? node.attrs.label : "";
  const kindAttr = typeof node.attrs?.mentionKind === "string" ? node.attrs.mentionKind : null;
  const kind = resolveMentionKindAttr(rawId, kindAttr);
  let tag = "mention-page";
  let id = stripPagePrefix(rawId);
  if (kind === "member") {
    tag = "mention-user";
    id = stripMemberPrefix(rawId);
  } else if (kind === "database") {
    tag = "mention-database";
    id = stripDatabasePrefix(rawId);
  }
  return `<${tag} id="${escapeAttr(id)}">${escapeLabel(label)}</${tag}>`;
}

function renderLeaf(node: DocNode, opts: InlineOptions): string {
  const br = opts.breakMode === "br" ? "<br>" : "\n";
  switch (node.type) {
    case "text": {
      const text = node.text ?? "";
      if (hasCode(node)) return codeSpan(text.replace(/\n/g, " "));
      return escapeText(text, opts.inTable).replace(/\n/g, br);
    }
    case "hardBreak":
      return br;
    case "mention":
      return mentionTag(node);
    case "pageLink": {
      const id = typeof node.attrs?.id === "string" ? node.attrs.id : "";
      const label = typeof node.attrs?.label === "string" ? node.attrs.label : "";
      return `<page-link id="${escapeAttr(id)}">${escapeLabel(label)}</page-link>`;
    }
    default: {
      const spec = ATTR_TAG_BY_TYPE.get(node.type);
      if (spec?.inline) return formatAttrTag(spec, node);
      // 알 수 없는 인라인 노드는 텍스트만 보존
      return serializeInline(node.content, opts);
    }
  }
}

/**
 * 문단 내 줄바꿈은 개행으로 쓰되, 개행이 사라지거나(맨 앞/뒤·연속 → 빈 줄로 문단 분리)
 * 줄 앞뒤 공백이 잘리는 위치에서는 <br> 로 쓴다.
 */
function hardBreak(items: DocNode[], index: number, out: string, opts: InlineOptions): string {
  if (opts.breakMode === "br") return "<br>";
  const next = items[index + 1];
  const unsafe =
    index === 0 ||
    next === undefined ||
    next.type === "hardBreak" ||
    isWhitespace(out[out.length - 1]) ||
    (next.type === "text" && isWhitespace((next.text ?? "")[0]));
  return unsafe ? "<br>" : "\n";
}

/** 이탤릭을 `_` 로 쓰면 단어 내부/공백 경계에서 깨지는지 판정 → 깨지면 <em> 사용 */
function needsEmTag(items: DocNode[], start: number, prevChar: string | undefined): boolean {
  let end = start;
  while (end + 1 < items.length && sortedMarks(items[end + 1] as DocNode).some((m) => m.type === "italic")) {
    end += 1;
  }
  const first = rawText(items[start])[0];
  const lastText = rawText(items[end]);
  const last = lastText[lastText.length - 1];
  const next = rawText(items[end + 1])[0];
  return isAlnum(prevChar) || isWhitespace(first) || isWhitespace(last) || isAlnum(next);
}

function openMark(mark: DocMark, items: DocNode[], index: number, out: string): OpenMark {
  switch (mark.type) {
    case "link":
      return { mark, close: `](${formatHref(String(mark.attrs?.href ?? ""))})` };
    case "textStyle":
      return { mark, close: "</span>" };
    case "highlight":
      return { mark, close: "</mark>" };
    case "underline":
      return { mark, close: "</u>" };
    case "bold":
      return { mark, close: "**" };
    case "italic":
      return needsEmTag(items, index, out[out.length - 1])
        ? { mark, close: "</em>" }
        : { mark, close: "_" };
    default:
      return { mark, close: "~~" };
  }
}

function openString(open: OpenMark): string {
  const { mark, close } = open;
  if (mark.type === "link") return "[";
  if (mark.type === "textStyle") return `<span color="${escapeAttr(markColor(mark) ?? "")}">`;
  if (mark.type === "highlight") {
    const color = markColor(mark);
    return color ? `<mark color="${escapeAttr(color)}">` : "<mark>";
  }
  if (mark.type === "underline") return "<u>";
  if (mark.type === "italic") return close === "_" ? "_" : "<em>";
  return close;
}

export function serializeInline(nodes: DocNode[] | undefined, opts: InlineOptions): string {
  const items = (nodes ?? []).filter((n) => n.type !== "text" || (n.text ?? "") !== "");
  const stack: OpenMark[] = [];
  let out = "";
  items.forEach((node, index) => {
    const marks = sortedMarks(node);
    let keep = 0;
    while (
      keep < stack.length &&
      keep < marks.length &&
      sameMark((stack[keep] as OpenMark).mark, marks[keep] as DocMark)
    ) {
      keep += 1;
    }
    while (stack.length > keep) out += (stack.pop() as OpenMark).close;
    for (const mark of marks.slice(keep)) {
      const open = openMark(mark, items, index, out);
      out += openString(open);
      stack.push(open);
    }
    out += node.type === "hardBreak" ? hardBreak(items, index, out, opts) : renderLeaf(node, opts);
  });
  while (stack.length > 0) out += (stack.pop() as OpenMark).close;
  return out;
}
