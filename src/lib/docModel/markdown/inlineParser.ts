// QFM 인라인 문자열 → TipTap 인라인 노드 배열.
import type { DocMark, DocNode } from "../types";
import {
  MENTION_DATABASE_PREFIX,
  MENTION_MEMBER_PREFIX,
  MENTION_PAGE_PREFIX,
  hasDatabasePrefix,
  hasMemberPrefix,
  hasPagePrefix,
} from "../../tiptapExtensions/mentionKind";
import {
  type ScanMemo,
  createScanMemo,
  findCodeSpanEnd,
  matchEmphasis,
  matchLink,
  runLength,
  tagPairs,
} from "./inlineScan";
import { ATTR_TAG_BY_TAG, attrsFromTag, hasRequiredAttrs } from "./nodeSpecs";
import { isAsciiPunct, isDangerousUrl, isSafeColor, parseTagAttrs, unescapeBackslashes } from "./textEscape";

// ProseMirror 스키마의 마크 순서(정규화용)
const SCHEMA_MARK_ORDER = ["link", "textStyle", "bold", "code", "italic", "strike", "underline", "highlight"];

const MARK_TAGS: Record<string, string> = {
  span: "textStyle",
  mark: "highlight",
  u: "underline",
  ins: "underline",
  strong: "bold",
  b: "bold",
  em: "italic",
  i: "italic",
  s: "strike",
  del: "strike",
  strike: "strike",
};

const MENTION_TAGS: Record<string, { prefix: string; kind: string; has: (id: string) => boolean }> = {
  "mention-page": { prefix: MENTION_PAGE_PREFIX, kind: "page", has: hasPagePrefix },
  "mention-user": { prefix: MENTION_MEMBER_PREFIX, kind: "member", has: hasMemberPrefix },
  "mention-database": { prefix: MENTION_DATABASE_PREFIX, kind: "database", has: hasDatabasePrefix },
};

// sticky 정규식 — 매 `<` 마다 문자열을 잘라 복사하지 않도록 lastIndex 로 위치를 지정한다.
// 속성부는 [^<>] 로 제한해 닫히지 않은 태그가 문서 끝까지 재스캔되지 않게 한다.
const AUTOLINK_RE = /<((?:https?|mailto):[^\s<>]+)>/iy;
const BR_RE = /<br\s*\/?>/iy;
const MENTION_RE =
  /<(mention-page|mention-user|mention-database|page-link)(\s[^<>]*?)?(?:\/>|>((?:\\[\s\S]|[^<\\])*)<\/\1\s*>)/iy;
const ATTR_TAG_RE = /<([a-z][\w-]*)(\s[^<>]*?)?\s*(\/?)>/iy;
const MARK_TAG_RE = /<([a-z]+)(\s[^<>]*)?>/iy;
const DATE_VALUE = /^(\d{4})-(\d{2})-(\d{2})$/;

type State = { s: string; memo: ScanMemo; depth: number };

// 중첩 마크 재귀 상한 — 초과분은 리터럴로 처리(스택 오버플로 방지)
const MAX_INLINE_DEPTH = 32;
type TagMatch = { nodes: DocNode[]; end: number };

function execAt(re: RegExp, s: string, i: number, to: number): RegExpExecArray | null {
  re.lastIndex = i;
  const m = re.exec(s);
  return m && i + m[0].length <= to ? m : null;
}

function withMark(marks: DocMark[], mark: DocMark): DocMark[] {
  return [...marks.filter((m) => m.type !== mark.type), mark];
}

function normalizeMarks(marks: DocMark[]): DocMark[] | undefined {
  // code 마크는 스키마상 다른 마크를 모두 배제한다
  const effective = marks.some((m) => m.type === "code") ? [{ type: "code" }] : marks;
  if (effective.length === 0) return undefined;
  return [...effective].sort((a, b) => SCHEMA_MARK_ORDER.indexOf(a.type) - SCHEMA_MARK_ORDER.indexOf(b.type));
}

function textNode(text: string, marks: DocMark[]): DocNode {
  const normalized = normalizeMarks(marks);
  return normalized ? { type: "text", text, marks: normalized } : { type: "text", text };
}

function atomNode(type: string, attrs: Record<string, unknown>, marks: DocMark[]): DocNode {
  const normalized = normalizeMarks(marks);
  return normalized ? { type, attrs, marks: normalized } : { type, attrs };
}

function colorFrom(attrs: Record<string, string>): string | null {
  const raw = attrs.color ?? attrs.style?.match(/(?:^|;)\s*(?:background-)?color\s*:\s*([^;]+)/i)?.[1];
  const color = raw?.trim();
  return color && isSafeColor(color) ? color : null;
}

function isValidDate(value: string): boolean {
  const m = value.match(DATE_VALUE);
  if (!m) return false;
  const month = Number(m[2]);
  const day = Number(m[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

function matchMentionTag(st: State, i: number, to: number, marks: DocMark[]): TagMatch | null {
  const m = execAt(MENTION_RE, st.s, i, to);
  if (!m) return null;
  const tag = (m[1] ?? "").toLowerCase();
  const attrs = parseTagAttrs(m[2]);
  const label = unescapeBackslashes(m[3] ?? "");
  const id = attrs.id ?? "";
  const end = m[0].length;
  if (tag === "page-link") return { nodes: [atomNode("pageLink", { id, label }, marks)], end };
  const spec = MENTION_TAGS[tag];
  if (!spec || !id) return { nodes: [], end };
  const fullId = spec.has(id) ? id : `${spec.prefix}${id}`;
  return { nodes: [atomNode("mention", { id: fullId, label, mentionKind: spec.kind }, marks)], end };
}

function matchAttrTag(st: State, i: number, to: number, marks: DocMark[]): TagMatch | null {
  const m = execAt(ATTR_TAG_RE, st.s, i, to);
  const spec = m ? ATTR_TAG_BY_TAG.get((m[1] ?? "").toLowerCase()) : undefined;
  if (!m || !spec?.inline) return null;
  const raw = parseTagAttrs(m[2]);
  let end = i + m[0].length;
  if (!m[3]) {
    const close = tagPairs(st.s, spec.tag, st.memo).get(i);
    if (close && close.end <= to) {
      if (raw.label === undefined && "label" in spec.attrs) {
        raw.label = unescapeBackslashes(st.s.slice(end, close.start).trim());
      }
      end = close.end;
    }
  }
  const len = end - i;
  if (spec.nodeType === "dateInline") {
    // 값이 없으면 버리고, 형식이 틀리면 원문 값을 텍스트로 강등(서버 기본값 2000-01-01 방지)
    const value = (raw.value ?? "").trim();
    if (!value) return { nodes: [], end: len };
    if (!isValidDate(value)) return { nodes: [textNode(value, marks)], end: len };
  }
  const attrs = attrsFromTag(spec, raw);
  if (!hasRequiredAttrs(spec, attrs)) return { nodes: [], end: len };
  return { nodes: [atomNode(spec.nodeType, attrs, marks)], end: len };
}

function matchMarkTag(st: State, i: number, to: number, marks: DocMark[]): TagMatch | null {
  const m = execAt(MARK_TAG_RE, st.s, i, to);
  const tag = (m?.[1] ?? "").toLowerCase();
  const markType = MARK_TAGS[tag];
  if (!m || !markType) return null;
  const close = tagPairs(st.s, tag, st.memo).get(i);
  if (!close || close.end > to) return null;
  const attrs = parseTagAttrs(m[2]);
  let next = marks;
  if (markType === "textStyle") {
    const color = colorFrom(attrs);
    if (color) next = withMark(marks, { type: "textStyle", attrs: { color } });
  } else if (markType === "highlight") {
    const color = colorFrom(attrs);
    next = withMark(marks, color ? { type: "highlight", attrs: { color } } : { type: "highlight" });
  } else {
    next = withMark(marks, { type: markType });
  }
  return { nodes: nested(st, i + m[0].length, close.start, next), end: close.end - i };
}

function matchTag(st: State, i: number, to: number, marks: DocMark[]): TagMatch | null {
  const auto = execAt(AUTOLINK_RE, st.s, i, to);
  if (auto) {
    const href = auto[1] ?? "";
    return { nodes: [textNode(href, withMark(marks, { type: "link", attrs: { href } }))], end: auto[0].length };
  }
  const br = execAt(BR_RE, st.s, i, to);
  if (br) return { nodes: [{ type: "hardBreak" }], end: br[0].length };
  return matchMentionTag(st, i, to, marks) ?? matchAttrTag(st, i, to, marks) ?? matchMarkTag(st, i, to, marks);
}

function linkNodes(st: State, i: number, to: number, marks: DocMark[]): TagMatch | null {
  const link = matchLink(st.s, i, to, st.memo);
  if (!link) return null;
  const href = link.href.trim();
  const safe = href !== "" && !isDangerousUrl(href);
  const inner = safe ? withMark(marks, { type: "link", attrs: { href } }) : marks;
  if (link.isImage) {
    // 인라인 위치의 이미지는 블록으로 둘 수 없으므로 링크 텍스트로 보존
    const alt = unescapeBackslashes(st.s.slice(link.textFrom, link.textTo)) || href;
    return { nodes: alt ? [textNode(alt, inner)] : [], end: link.end - i };
  }
  return { nodes: nested(st, link.textFrom, link.textTo, inner), end: link.end - i };
}

function nested(st: State, from: number, to: number, marks: DocMark[]): DocNode[] {
  return parseRange({ ...st, depth: st.depth + 1 }, from, to, marks);
}

function parseRange(st: State, from: number, to: number, marks: DocMark[]): DocNode[] {
  const { s, memo } = st;
  const canNest = st.depth < MAX_INLINE_DEPTH;
  const out: DocNode[] = [];
  let buf = "";
  const emit = (nodes: DocNode[], next: number): number => {
    if (buf) out.push(textNode(buf, marks));
    buf = "";
    for (const node of nodes) out.push(node);
    return next;
  };
  let i = from;
  while (i < to) {
    const ch = s[i] ?? "";
    const next = s[i + 1];
    if (ch === "\\" && i + 1 < to && next === "\n") {
      i = emit([{ type: "hardBreak" }], i + 2);
    } else if (ch === "\\" && i + 1 < to && isAsciiPunct(next)) {
      buf += next;
      i += 2;
    } else if (ch === "\n") {
      i = emit([{ type: "hardBreak" }], i + 1);
    } else if (ch === "`") {
      const code = findCodeSpanEnd(s, i, to, memo);
      const n = runLength(s, i, to, "`");
      if (code) i = emit([textNode(code.text, withMark(marks, { type: "code" }))], code.end);
      else {
        buf += s.slice(i, i + n);
        i += n;
      }
    } else if (ch === "*" || ch === "_" || ch === "~") {
      const em = canNest ? matchEmphasis(s, i, to, memo) : null;
      const n = runLength(s, i, to, ch);
      if (em) {
        const inner = em.marks.reduce((acc, type) => withMark(acc, { type }), marks);
        i = emit(nested(st, em.innerFrom, em.innerTo, inner), em.end);
      } else {
        buf += s.slice(i, i + n);
        i += n;
      }
    } else if (ch === "[" || (ch === "!" && next === "[")) {
      const link = canNest ? linkNodes(st, i, to, marks) : null;
      if (link) i = emit(link.nodes, i + link.end);
      else {
        buf += ch;
        i += 1;
      }
    } else if (ch === "<") {
      const tag = canNest ? matchTag(st, i, to, marks) : null;
      if (tag) i = emit(tag.nodes, i + tag.end);
      else {
        buf += ch;
        i += 1;
      }
    } else {
      buf += ch;
      i += 1;
    }
  }
  emit([], to);
  return out;
}

function sameMarks(a: DocNode, b: DocNode): boolean {
  return JSON.stringify(a.marks ?? []) === JSON.stringify(b.marks ?? []);
}

/** 인접한 같은 마크 텍스트 노드를 합친다(선형 시간). */
function mergeText(nodes: DocNode[]): DocNode[] {
  const out: DocNode[] = [];
  for (const node of nodes) {
    const last = out[out.length - 1];
    if (last?.type === "text" && node.type === "text" && sameMarks(last, node)) {
      out[out.length - 1] = { ...last, text: (last.text ?? "") + (node.text ?? "") };
    } else {
      out.push(node);
    }
  }
  return out;
}

export function parseInline(text: string): DocNode[] {
  const st: State = { s: text, memo: createScanMemo(), depth: 0 };
  return mergeText(parseRange(st, 0, text.length, []));
}
