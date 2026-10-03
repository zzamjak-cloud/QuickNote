// QFM 줄 배열 → TipTap 블록 노드 배열.
import type { DocNode } from "../types";
import { CONTAINER_TAGS, alertCallout, parseContainer } from "./containerParser";
import { parseInline } from "./inlineParser";
import { QfmError } from "./errors";
import { createScanMemo, matchLink } from "./inlineScan";
import { emptyParagraph, ensureBlocks, indentOf, isBlank, isFenceLine } from "./lineUtils";
import { matchListMarker, parseList } from "./listParser";
import { ATTR_TAG_BY_TAG, attrsFromTag, hasRequiredAttrs } from "./nodeSpecs";
import { buildTable, isTableDelimiterLine, isTableRowLine } from "./tableMarkdown";
import { isDangerousUrl, parseTagAttrs, unescapeBackslashes } from "./textEscape";

export type ParseOptions = {
  resolveBlockRef?: (id: string) => DocNode | null;
};

// seenRefs: 같은 qn-block 참조의 중복 사용 감지(재귀 전체 공유)
type Ctx = ParseOptions & { depth: number; seenRefs: Set<string> };
type Step = { nodes: DocNode[]; next: number; trailing?: string };

// 재귀 폭주 방지 — 이보다 깊은 컨테이너 중첩은 평문 문단으로 취급
const MAX_DEPTH = 48;

const BLOCK_TAG_LINE = /^<([a-z][\w-]*)(\s[^>]*?)?\s*\/?>(?:\s*<\/\1\s*>)?$/i;
const HEADING = /^(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const CONTAINER_LINE = new RegExp(`^</?(${CONTAINER_TAGS.join("|")})(?=[\\s>/])`, "i");
const HR = /^(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;

function isBlockTagLine(t: string): boolean {
  const m = t.match(BLOCK_TAG_LINE);
  if (!m) return false;
  const tag = (m[1] ?? "").toLowerCase();
  const spec = ATTR_TAG_BY_TAG.get(tag);
  return ["database", "qn-block", "empty-block", "br"].includes(tag) || (spec !== undefined && !spec.inline);
}

function isLoneImage(t: string): boolean {
  if (!t.startsWith("![")) return false;
  return matchLink(t, 0, t.length, createScanMemo())?.end === t.length;
}

export function isBlockStart(lines: string[], i: number): boolean {
  const line = lines[i] ?? "";
  const t = line.trim();
  if (!t) return true;
  return (
    isFenceLine(line) ||
    HEADING.test(t) ||
    HR.test(t) ||
    t.startsWith(">") ||
    matchListMarker(line) !== null ||
    CONTAINER_LINE.test(t) ||
    isBlockTagLine(t) ||
    isLoneImage(t) ||
    (isTableRowLine(t) && isTableDelimiterLine(lines[i + 1] ?? ""))
  );
}

function cloneRef(ctx: Ctx, id: string | undefined): DocNode | null {
  if (!id || !ctx.resolveBlockRef) return null;
  const node = ctx.resolveBlockRef(id);
  return node && typeof node === "object" && typeof node.type === "string" ? structuredClone(node) : null;
}

function databaseNode(raw: Record<string, string>, ctx: Ctx): DocNode | null {
  const databaseId = raw.id ?? raw.databaseId;
  if (!databaseId) return null;
  const overrides: Record<string, unknown> = {};
  if (raw.layout === "inline" || raw.layout === "fullPage") overrides.layout = raw.layout;
  if (raw.view) overrides.view = raw.view;
  if (raw.readOnlyTitle !== undefined) overrides.readOnlyTitle = raw.readOnlyTitle !== "false";
  // 원본 블록이 있으면 panelState 등 표시 설정을 그대로 복원
  const original = cloneRef(ctx, databaseId);
  if (original?.type === "databaseBlock" && original.attrs?.databaseId === databaseId) {
    return { ...original, attrs: { ...original.attrs, ...overrides } };
  }
  return { type: "databaseBlock", attrs: { databaseId, layout: "inline", ...overrides } };
}

/**
 * qn-block → 원본 노드로 무손실 복원. id 없는 자리표시자·resolver 미지정이면 버린다.
 * resolver 가 있는데 해석 실패/중복 사용이면 원본 블록이 조용히 삭제·복제되지 않도록 예외.
 */
function qnBlockNode(id: string | undefined, ctx: Ctx): DocNode[] {
  if (!id || !ctx.resolveBlockRef) return [];
  if (ctx.seenRefs.has(id)) {
    throw new QfmError("DUPLICATE_BLOCK_REF", `qn-block id "${id}" is used more than once`, id);
  }
  ctx.seenRefs.add(id);
  const node = cloneRef(ctx, id);
  if (!node) throw new QfmError("UNRESOLVED_BLOCK_REF", `qn-block id "${id}" cannot be resolved`, id);
  return [node];
}

function blockTagNode(t: string, ctx: Ctx): DocNode[] {
  const m = t.match(BLOCK_TAG_LINE);
  const tag = (m?.[1] ?? "").toLowerCase();
  const raw = parseTagAttrs(m?.[2]);
  if (tag === "empty-block" || tag === "br") return [emptyParagraph()];
  if (tag === "database") return [databaseNode(raw, ctx)].filter((n): n is DocNode => n !== null);
  if (tag === "qn-block") return qnBlockNode(raw.id, ctx);
  const spec = ATTR_TAG_BY_TAG.get(tag);
  if (!spec) return [];
  const attrs = attrsFromTag(spec, raw);
  if (!hasRequiredAttrs(spec, attrs)) return [];
  return [{ type: spec.nodeType, ...(Object.keys(attrs).length > 0 ? { attrs } : {}) }];
}

function imageNode(t: string): DocNode[] {
  const link = matchLink(t, 0, t.length, createScanMemo());
  if (!link) return [];
  const src = link.href.trim();
  if (!src || isDangerousUrl(src)) return [];
  const alt = unescapeBackslashes(t.slice(link.textFrom, link.textTo));
  const attrs: Record<string, unknown> = { src };
  if (alt) attrs.alt = alt;
  if (link.title) attrs.title = link.title;
  return [{ type: "image", attrs }];
}

function parseFence(lines: string[], i: number): Step {
  const line = lines[i] ?? "";
  const indent = indentOf(line);
  const open = line.trim().match(/^(`{3,}|~{3,})\s*([^\s`]*)/);
  const fence = open?.[1] ?? "```";
  const lang = open?.[2] ?? "";
  const closeRe = new RegExp(`^\\s*${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`);
  const code: string[] = [];
  let j = i + 1;
  while (j < lines.length && !closeRe.test(lines[j] ?? "")) {
    const l = lines[j] ?? "";
    code.push(l.slice(Math.min(indent, indentOf(l))));
    j += 1;
  }
  const text = code.join("\n");
  const node: DocNode = {
    type: "codeBlock",
    ...(lang ? { attrs: { language: lang } } : {}),
    ...(text ? { content: [{ type: "text", text }] } : {}),
  };
  return { nodes: [node], next: Math.min(j + 1, lines.length) };
}

function parseQuote(lines: string[], i: number, ctx: Ctx): Step {
  const inner: string[] = [];
  let j = i;
  while (j < lines.length && (lines[j] ?? "").trim().startsWith(">")) {
    inner.push((lines[j] ?? "").trim().replace(/^> ?/, ""));
    j += 1;
  }
  const parse = (ls: string[]): DocNode[] => parseBlocksWith(ls, ctx);
  const alert = alertCallout(inner, parse);
  if (alert) return { nodes: [alert], next: j };
  return { nodes: [{ type: "blockquote", content: ensureBlocks(parse(inner)) }], next: j };
}

function parseParagraph(lines: string[], i: number): Step {
  const parts: string[] = [(lines[i] ?? "").trim()];
  let j = i + 1;
  while (j < lines.length && !isBlockStart(lines, j)) {
    parts.push((lines[j] ?? "").trim());
    j += 1;
  }
  const inline = parseInline(parts.join("\n"));
  return { nodes: inline.length > 0 ? [{ type: "paragraph", content: inline }] : [], next: j };
}

function parseStep(lines: string[], i: number, ctx: Ctx): Step {
  const line = lines[i] ?? "";
  const t = line.trim();
  const parse = (ls: string[]): DocNode[] => parseBlocksWith(ls, ctx);
  if (isFenceLine(line)) return parseFence(lines, i);
  const container = parseContainer(lines, i, parse);
  if (container) return container;
  if (/^<\/(callout|details|columns|column|summary)\s*>$/i.test(t)) return { nodes: [], next: i + 1 };
  if (isBlockTagLine(t)) return { nodes: blockTagNode(t, ctx), next: i + 1 };
  const heading = t.match(HEADING);
  if (heading) {
    const inline = parseInline(heading[2] ?? "");
    const level = (heading[1] ?? "#").length;
    return {
      nodes: [{ type: "heading", attrs: { level }, ...(inline.length > 0 ? { content: inline } : {}) }],
      next: i + 1,
    };
  }
  if (HR.test(t)) return { nodes: [{ type: "horizontalRule" }], next: i + 1 };
  if (t.startsWith(">")) return parseQuote(lines, i, ctx);
  if (isTableRowLine(t) && isTableDelimiterLine(lines[i + 1] ?? "")) {
    let j = i + 2;
    while (j < lines.length && isTableRowLine(lines[j] ?? "") && !isBlank(lines[j])) j += 1;
    const node = buildTable(t, lines[i + 1] ?? "", lines.slice(i + 2, j), parseInline);
    return { nodes: [node], next: j };
  }
  const list = parseList(lines, i, parse, isBlockStart);
  if (list) return { nodes: [list.node], next: list.next };
  if (isLoneImage(t)) return { nodes: imageNode(t), next: i + 1 };
  return parseParagraph(lines, i);
}

function parseBlocksWith(input: string[], parent: Ctx): DocNode[] {
  const ctx: Ctx = { ...parent, depth: parent.depth + 1 };
  if (ctx.depth > MAX_DEPTH) {
    const text = input.filter((l) => !isBlank(l)).join("\n");
    return text ? [{ type: "paragraph", content: [{ type: "text", text }] }] : [];
  }
  const lines = [...input];
  const out: DocNode[] = [];
  let i = 0;
  while (i < lines.length) {
    if (isBlank(lines[i])) {
      i += 1;
      continue;
    }
    const step = parseStep(lines, i, ctx);
    out.push(...step.nodes);
    // 닫는 태그 뒤 같은 줄에 남은 내용은 다음 줄로 이어서 파싱
    if (step.trailing && !isBlank(step.trailing)) lines.splice(step.next, 0, step.trailing);
    i = Math.max(step.next, i + 1);
  }
  return out;
}

export function parseBlocks(lines: string[], options: ParseOptions = {}): DocNode[] {
  return parseBlocksWith(lines, { ...options, depth: 0, seenRefs: new Set() });
}
