import type { Node as PMNode } from "@tiptap/pm/model";
import { docTopLevelBlockStart } from "./docTopLevelBlockStart";

/** `doc` 직속 블록만 순회 — `fragmentOffset` 은 `docTopLevelBlockStart` 와 동일한 좌표 규칙. */
export function forEachDocDirectBlock(
  doc: PMNode,
  fn: (node: PMNode, blockStart: number, fragmentOffset: number) => void,
): void {
  doc.forEach((node, fragmentOffset) => {
    if (!node.isBlock) return;
    fn(node, docTopLevelBlockStart(fragmentOffset), fragmentOffset);
  });
}

/**
 * PM 텍스트 선택(from..to)과 겹치는 doc 직속 블록의 시작 좌표들.
 * (Shift+화살표 다중 블록 · 박스 그룹 오버레이 등)
 */
export function topLevelBlockStartsInSelectionRange(
  doc: PMNode,
  from: number,
  to: number,
): number[] {
  if (from === to) return [];
  const starts: number[] = [];
  forEachDocDirectBlock(doc, (node, blockStart) => {
    const blockEnd = blockStart + node.nodeSize;
    if (blockEnd > from && blockStart < to) starts.push(blockStart);
  });
  return starts;
}

/**
 * 직속 블록의 끝 위치가 `endPos`와 일치할 때 그 블록의 시작 좌표(이전 블록 찾기용).
 * 없으면 null.
 */
export function topLevelBlockStartEndingAt(
  doc: PMNode,
  endPos: number,
): number | null {
  let found: number | null = null;
  forEachDocDirectBlock(doc, (node, blockStart) => {
    if (blockStart + node.nodeSize === endPos) found = blockStart;
  });
  return found;
}
