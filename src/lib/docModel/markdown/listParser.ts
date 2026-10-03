// 글머리/번호/할 일 목록 파서 — 항목 본문은 재귀 블록 파싱(중첩 목록·블록 지원).
import type { DocNode } from "../types";
import { type BlockParser, emptyParagraph, indentOf, isBlank, nextNonBlank } from "./lineUtils";

type ListKind = "bullet" | "ordered" | "task";

export type ListMarker = {
  indent: number;
  kind: ListKind;
  contentOffset: number;
  rest: string;
  start: number;
  checked: boolean;
};

export function matchListMarker(line: string): ListMarker | null {
  const m = line.match(/^( *)([-*+]|\d{1,9}[.)])(?:( +)(.*))?$/);
  if (!m) return null;
  const indent = (m[1] ?? "").length;
  const marker = m[2] ?? "";
  const spaces = (m[3] ?? "").length;
  let rest = m[4] ?? "";
  const ordered = /^\d/.test(marker);
  const contentOffset = indent + marker.length + (spaces === 0 || spaces > 4 ? 1 : spaces);
  let kind: ListKind = ordered ? "ordered" : "bullet";
  let checked = false;
  if (!ordered) {
    const task = rest.match(/^\[([ xX])\](?: +(.*))?$/);
    if (task) {
      kind = "task";
      checked = (task[1] ?? " ").toLowerCase() === "x";
      rest = task[2] ?? "";
    }
  }
  return { indent, kind, contentOffset, rest, start: ordered ? parseInt(marker, 10) : 1, checked };
}

function isSibling(line: string | undefined, kind: ListKind, base: number): boolean {
  const m = line === undefined ? null : matchListMarker(line);
  return m !== null && m.kind === kind && m.indent >= base && m.indent <= base + 1;
}

function buildItem(kind: ListKind, checked: boolean, children: DocNode[]): DocNode {
  if (kind === "task") {
    // taskItem 스키마: paragraph block*
    const content = children[0]?.type === "paragraph" ? children : [emptyParagraph(), ...children];
    return { type: "taskItem", attrs: { checked }, content };
  }
  return { type: "listItem", content: children.length > 0 ? children : [emptyParagraph()] };
}

function buildList(kind: ListKind, start: number, items: DocNode[]): DocNode {
  if (kind === "task") return { type: "taskList", content: items };
  if (kind === "ordered") {
    return { type: "orderedList", ...(start !== 1 ? { attrs: { start } } : {}), content: items };
  }
  return { type: "bulletList", content: items };
}

/** 항목 본문 줄 수집(들여쓰기 연속 줄·빈 줄 후 들여쓴 줄·게으른 문단 연속). */
function collectItemLines(
  lines: string[],
  from: number,
  marker: ListMarker,
  isBlockStart: (lines: string[], i: number) => boolean,
): { itemLines: string[]; next: number } {
  const threshold = Math.min(marker.contentOffset, marker.indent + 2);
  const itemLines = [marker.rest];
  let i = from;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (isBlank(line)) {
      const j = nextNonBlank(lines, i);
      if (j >= lines.length || indentOf(lines[j] ?? "") < threshold) break;
      for (let k = i; k < j; k += 1) itemLines.push("");
      i = j;
      continue;
    }
    const ind = indentOf(line);
    if (ind >= threshold) {
      itemLines.push(line.slice(Math.min(ind, marker.contentOffset)));
      i += 1;
      continue;
    }
    const last = itemLines[itemLines.length - 1];
    if (!isBlank(last) && !isBlockStart(lines, i)) {
      itemLines.push(line.trim());
      i += 1;
      continue;
    }
    break;
  }
  return { itemLines, next: i };
}

export function parseList(
  lines: string[],
  start: number,
  parse: BlockParser,
  isBlockStart: (lines: string[], i: number) => boolean,
): { node: DocNode; next: number } | null {
  const first = matchListMarker(lines[start] ?? "");
  if (!first) return null;
  const items: DocNode[] = [];
  let i = start;
  while (i < lines.length) {
    if (isBlank(lines[i])) {
      const j = nextNonBlank(lines, i);
      if (!isSibling(lines[j], first.kind, first.indent)) break;
      i = j;
    }
    const marker = matchListMarker(lines[i] ?? "");
    if (!marker || !isSibling(lines[i], first.kind, first.indent)) break;
    const { itemLines, next } = collectItemLines(lines, i + 1, marker, isBlockStart);
    items.push(buildItem(marker.kind, marker.checked, parse(itemLines)));
    i = next;
  }
  return { node: buildList(first.kind, first.start, items), next: i };
}
