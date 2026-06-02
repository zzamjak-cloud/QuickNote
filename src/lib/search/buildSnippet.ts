import { koreanMatchRange } from "../koreanSearch";
import type { BlockText } from "./extractPageText";

/** 스니펫 — match 부분만 하이라이트 렌더 */
export type Snippet = {
  before: string;
  match: string;
  after: string;
};

/** 검색 결과 클릭 시 이동할 블록 참조(blockId 우선, 없으면 blockIndex) */
export type BlockRef = {
  blockId: string | null;
  blockIndex: number;
};

export type SnippetHit = {
  snippet: Snippet;
  blockRef: BlockRef;
};

const CONTEXT_BEFORE = 32;
const CONTEXT_AFTER = 72;

/** 단일 블록 텍스트에서 query 주변 컨텍스트 스니펫을 만든다. 매치 없으면 null. */
export function buildSnippetFromText(text: string, queryLower: string): Snippet | null {
  const range = koreanMatchRange(text.toLowerCase(), queryLower);
  if (!range) return null;
  const { index, length } = range;
  const start = Math.max(0, index - CONTEXT_BEFORE);
  const end = Math.min(text.length, index + length + CONTEXT_AFTER);
  const before = (start > 0 ? "…" : "") + text.slice(start, index);
  const match = text.slice(index, index + length);
  const after = text.slice(index + length, end) + (end < text.length ? "…" : "");
  return { before, match, after };
}

/**
 * 페이지의 블록들 중 query 가 매치되는 첫 블록의 스니펫 + 이동 참조를 반환한다.
 * blocks 는 문서 순서이므로 첫 매치 = 본문 상단 우선.
 */
export function findBestSnippet(blocks: BlockText[], queryLower: string): SnippetHit | null {
  for (const block of blocks) {
    const snippet = buildSnippetFromText(block.text, queryLower);
    if (snippet) {
      return {
        snippet,
        blockRef: { blockId: block.blockId, blockIndex: block.blockIndex },
      };
    }
  }
  return null;
}
