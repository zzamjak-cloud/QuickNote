import type { JSONContent } from "@tiptap/react";
import { collectNodeText } from "./search/tiptapText";

export type OutlineItem = {
  /** 1~4 */
  level: number;
  text: string;
};

// 공용 텍스트 추출 유틸 재사용(검색 인덱스와 동일 로직 공유)
const extractTextFromJson = collectNodeText;

/**
 * 현재 페이지 doc JSON에서 헤딩(# ~ ####)만 깊이 우선 순서로 추출.
 * 에디터 descendants 순서와 맞추기 위해 content 트리를 동일하게 순회한다.
 */
export function extractOutlineFromDocJson(
  doc: JSONContent | undefined,
): OutlineItem[] {
  const out: OutlineItem[] = [];

  function walk(nodes: JSONContent[] | undefined): void {
    if (!nodes) return;
    for (const n of nodes) {
      if (n.type === "heading" && n.attrs && typeof n.attrs.level === "number") {
        const raw = n.attrs.level;
        const level = Math.min(4, Math.max(1, Math.floor(raw)));
        if (level >= 1 && level <= 4) {
          out.push({ level, text: extractTextFromJson(n).trim() || "제목 없음" });
        }
      }
      if (n.content?.length) walk(n.content);
    }
  }

  walk(doc?.content);
  return out;
}
