// 컨테이너 블록(<callout>, <details>, <columns>) 파서.
import type { DocNode } from "../types";
import { parseInline } from "./inlineParser";
import {
  type BlockParser,
  dedent,
  ensureBlocks,
  isBlank,
  readContainer,
} from "./lineUtils";
import { parseTagAttrs } from "./textEscape";

export type ContainerResult = { nodes: DocNode[]; next: number; trailing: string };

export const CONTAINER_TAGS = ["callout", "details", "columns", "column"];

// GitHub 경고 문법(> [!NOTE]) → 콜아웃 프리셋
const ALERT_PRESETS: Record<string, string> = {
  note: "note",
  tip: "tip",
  important: "info",
  info: "info",
  warning: "warning",
  caution: "danger",
  danger: "danger",
  idea: "idea",
  success: "success",
};

export function calloutNode(preset: string | undefined, emoji: string | undefined, body: DocNode[]): DocNode {
  const attrs: Record<string, unknown> = {};
  if (preset) attrs.preset = preset;
  if (emoji) attrs.emoji = emoji;
  return {
    type: "callout",
    ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
    content: ensureBlocks(body),
  };
}

/** 인용 첫 줄이 `[!type]` 이면 콜아웃으로 변환. */
export function alertCallout(quoteLines: string[], parse: BlockParser): DocNode | null {
  const m = (quoteLines[0] ?? "").trim().match(/^\[!(\w+)\]\s*(.*)$/);
  if (!m) return null;
  const preset = ALERT_PRESETS[(m[1] ?? "").toLowerCase()] ?? "note";
  const body = [m[2] ?? "", ...quoteLines.slice(1)];
  return calloutNode(preset, undefined, parse(body));
}

function parseCallout(lines: string[], i: number, parse: BlockParser): ContainerResult | null {
  const read = readContainer(lines, i, "callout");
  if (!read) return null;
  const attrs = parseTagAttrs(read.attrs);
  const node = calloutNode(attrs.preset?.trim() || undefined, attrs.icon || attrs.emoji || undefined, parse(dedent(read.inner)));
  return { nodes: [node], next: read.next, trailing: read.trailing };
}

function parseToggle(lines: string[], i: number, parse: BlockParser): ContainerResult | null {
  const read = readContainer(lines, i, "details");
  if (!read) return null;
  const attrs = parseTagAttrs(read.attrs);
  const inner = dedent(read.inner);
  const firstIdx = inner.findIndex((l) => !isBlank(l));
  const summary = (inner[firstIdx] ?? "").trim().match(/^<summary(\s[^>]*?)?>(.*?)(?:<\/summary>(.*))?$/i);
  let title = "";
  let level: string | undefined;
  let body = inner;
  if (summary && firstIdx >= 0) {
    title = summary[2] ?? "";
    level = parseTagAttrs(summary[1]).level || undefined;
    body = [summary[3] ?? "", ...inner.slice(firstIdx + 1)];
  }
  const headerInline = parseInline(title.trim());
  const node: DocNode = {
    type: "toggle",
    attrs: { open: attrs.open !== undefined },
    content: [
      {
        type: "toggleHeader",
        ...(level ? { attrs: { titleLevel: level } } : {}),
        ...(headerInline.length > 0 ? { content: headerInline } : {}),
      },
      { type: "toggleContent", content: ensureBlocks(parse(body)) },
    ],
  };
  return { nodes: [node], next: read.next, trailing: read.trailing };
}

type ParsedColumn = { width: number | null; blocks: DocNode[] };

function readColumns(inner: string[], parse: BlockParser): ParsedColumn[] {
  const lines = [...inner];
  const cols: ParsedColumn[] = [];
  let stray: string[] = [];
  const flushStray = (): void => {
    if (stray.some((l) => !isBlank(l))) cols.push({ width: null, blocks: parse(dedent(stray)) });
    stray = [];
  };
  let j = 0;
  while (j < lines.length) {
    const t = (lines[j] ?? "").trim();
    if (/^<column(?=[\s>/])/i.test(t)) {
      flushStray();
      const read = readContainer(lines, j, "column");
      if (!read) break;
      const width = Number(parseTagAttrs(read.attrs).width);
      cols.push({ width: Number.isFinite(width) && width > 0 ? width : null, blocks: parse(dedent(read.inner)) });
      if (!isBlank(read.trailing)) lines.splice(read.next, 0, read.trailing);
      j = read.next;
    } else {
      if (!/^<\/column>$/i.test(t)) stray.push(lines[j] ?? "");
      j += 1;
    }
  }
  flushStray();
  return cols;
}

function parseColumns(lines: string[], i: number, parse: BlockParser): ContainerResult | null {
  const read = readContainer(lines, i, "columns");
  if (!read) return null;
  const preset = parseTagAttrs(read.attrs).preset?.trim();
  const cols = readColumns(dedent(read.inner), parse);
  if (cols.length < 2) {
    // 단일 열은 컬럼 레이아웃 스키마(column{2,6})를 만족하지 못하므로 내용만 펼친다
    return { nodes: cols.flatMap((c) => c.blocks), next: read.next, trailing: read.trailing };
  }
  // 7열 이상은 스키마 상한(6)에 맞춰 마지막 열에 합친다
  const tail = cols.slice(5);
  const merged =
    cols.length <= 6
      ? cols
      : [...cols.slice(0, 5), { width: tail[0]?.width ?? null, blocks: tail.flatMap((c) => c.blocks) }];
  const node: DocNode = {
    type: "columnLayout",
    attrs: { columns: merged.length, ...(preset ? { preset } : {}) },
    content: merged.map((c) => ({
      type: "column",
      ...(c.width !== null ? { attrs: { width: c.width } } : {}),
      content: ensureBlocks(c.blocks),
    })),
  };
  return { nodes: [node], next: read.next, trailing: read.trailing };
}

/** 컨테이너 태그로 시작하는 줄이면 파싱, 아니면 null. */
export function parseContainer(lines: string[], i: number, parse: BlockParser): ContainerResult | null {
  const t = (lines[i] ?? "").trim();
  if (/^<callout(?=[\s>/])/i.test(t)) return parseCallout(lines, i, parse);
  if (/^<details(?=[\s>/])/i.test(t)) return parseToggle(lines, i, parse);
  if (/^<columns(?=[\s>/])/i.test(t)) return parseColumns(lines, i, parse);
  if (/^<column(?=[\s>/])/i.test(t)) {
    // 단독 <column> 은 내용만 펼친다
    const read = readContainer(lines, i, "column");
    return read ? { nodes: parse(dedent(read.inner)), next: read.next, trailing: read.trailing } : null;
  }
  return null;
}
