// 블록 파서 공용 줄 단위 유틸.
import type { DocNode } from "../types";

export type BlockParser = (lines: string[]) => DocNode[];

export function emptyParagraph(): DocNode {
  return { type: "paragraph" };
}

export function indentOf(line: string): number {
  return line.match(/^ */)?.[0].length ?? 0;
}

export function isBlank(line: string | undefined): boolean {
  return line === undefined || line.trim() === "";
}

export function nextNonBlank(lines: string[], from: number): number {
  let j = from;
  while (j < lines.length && isBlank(lines[j])) j += 1;
  return j;
}

/** 공백 아닌 줄의 최소 들여쓰기만큼 제거. */
export function dedent(lines: string[]): string[] {
  const indents = lines.filter((l) => !isBlank(l)).map(indentOf);
  const min = indents.length > 0 ? Math.min(...indents) : 0;
  return min > 0 ? lines.map((l) => l.slice(Math.min(min, indentOf(l)))) : lines;
}

export function isFenceLine(line: string): boolean {
  return /^\s*(`{3,}|~{3,})/.test(line);
}

/** 블록 내용이 비면 빈 문단 하나로 채운다(block+ 스키마 충족). */
export function ensureBlocks(blocks: DocNode[]): DocNode[] {
  return blocks.length > 0 ? blocks : [emptyParagraph()];
}

export type ContainerRead = {
  attrs: string | undefined;
  inner: string[];
  next: number;
  trailing: string;
};

/**
 * lines[i] 에서 시작하는 `<tag ...>` ~ `</tag>` 컨테이너를 읽는다(같은 태그 중첩·코드펜스 고려).
 * 닫는 태그가 없으면 문서 끝까지를 내용으로 본다.
 */
export function readContainer(lines: string[], i: number, tag: string): ContainerRead | null {
  const first = (lines[i] ?? "").trim();
  const open = first.match(new RegExp(`^<${tag}(\\s[^>]*?)?\\s*(/?)>`, "i"));
  if (!open) return null;
  const attrs = open[1];
  let rest = first.slice(open[0].length);
  if (open[2]) return { attrs, inner: [], next: i + 1, trailing: rest };
  const re = new RegExp(`<(/?)${tag}(?=[\\s>/])[^>]*>`, "gi");
  const inner: string[] = [];
  let depth = 1;
  let inFence = false;
  let lineIdx = i;
  let isFirst = true;
  for (;;) {
    if (isFenceLine(rest)) inFence = !inFence;
    if (!inFence) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(rest)) !== null) {
        if (m[0].endsWith("/>")) continue;
        depth += m[1] ? -1 : 1;
        if (depth === 0) {
          const before = rest.slice(0, m.index);
          if (!isBlank(before)) inner.push(before);
          return { attrs, inner, next: lineIdx + 1, trailing: rest.slice(m.index + m[0].length) };
        }
      }
    }
    if (!isFirst || !isBlank(rest)) inner.push(rest);
    isFirst = false;
    lineIdx += 1;
    if (lineIdx >= lines.length) return { attrs, inner, next: lines.length, trailing: "" };
    rest = lines[lineIdx] ?? "";
  }
}
