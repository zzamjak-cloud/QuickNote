import type { Editor } from "@tiptap/react";
import { getSlashMenuEntries } from "../../blocks/registry";
import type {
  SlashCategoryItem,
  SlashLeafItem,
  SlashMenuEntry,
} from "./types";

// 조상 노드 타입 → 차단할 entry id 목록
const CONTEXT_BLOCK_RULES: Record<string, string[]> = {
  // 테이블 셀/헤더 안: 레이아웃·미디어·DB·컨테이너 블록 차단
  tableCell: ["tabBlock", "columnLayout", "table", "youtube", "image", "dbInline", "dbFullPage", "callout", "toggle", "headingToggle1", "headingToggle2", "headingToggle3", "codeBlock"],
  tableHeader: ["tabBlock", "columnLayout", "table", "youtube", "image", "dbInline", "dbFullPage", "callout", "toggle", "headingToggle1", "headingToggle2", "headingToggle3", "codeBlock"],
  // 탭 패널 안: 탭·DB 차단 (중첩 탭 및 너비 충돌)
  tabPanel: ["tabBlock", "dbInline", "dbFullPage"],
  // 컬럼 안: 표·탭 차단 (너비 충돌). 컬럼 중첩은 허용.
  column: ["table", "tabBlock"],
};

function getBlockedIds(editor: Editor): Set<string> {
  const { $from } = editor.state.selection;
  const blocked = new Set<string>();
  for (let d = $from.depth; d > 0; d--) {
    const nodeTypeName = $from.node(d).type.name;
    const ids = CONTEXT_BLOCK_RULES[nodeTypeName];
    if (ids) ids.forEach((id) => blocked.add(id));
  }
  return blocked;
}

import { koreanIncludes, koreanMatchScore } from "../../koreanSearch";

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

function scoreTextMatch(text: string, q: string): number {
  const t = normalized(text);
  if (!t || !q) return 0;
  return koreanMatchScore(t, q);
}

function scoreLeaf(item: SlashLeafItem, q: string): number {
  const titleScore = scoreTextMatch(item.title, q);
  const keywordScore = item.keywords.reduce((best, kw) => Math.max(best, scoreTextMatch(kw, q)), 0);
  // 동일 점수에서는 제목 매칭을 우선시
  return titleScore * 10 + keywordScore;
}

/** 루트 목록만 필터 (서브메뉴는 SlashMenu 내부에서 처리) */
export function filterSlashMenuEntries(query: string, editor?: Editor): SlashMenuEntry[] {
  const allEntries = getSlashMenuEntries();
  const blocked = editor ? getBlockedIds(editor) : new Set<string>();

  // 조상 노드 차단 + 기능 게이팅(available) 동시 적용
  const isLeafHidden = (item: SlashLeafItem) =>
    (item.id !== undefined && blocked.has(item.id)) ||
    item.available?.(editor) === false;

  const contextFiltered: SlashMenuEntry[] = allEntries.flatMap<SlashMenuEntry>((e) => {
    if (e.kind === "leaf") return isLeafHidden(e) ? [] : [e];
    const children = e.children.filter((c) => !isLeafHidden(c));
    return children.length > 0 ? [{ ...e, children }] : [];
  });

  const q = query.trim().toLowerCase();
  if (!q) return contextFiltered;

  function leafMatch(item: SlashLeafItem): boolean {
    if (koreanIncludes(item.title.toLowerCase(), q)) return true;
    return item.keywords.some((k) => koreanIncludes(k.toLowerCase(), q));
  }

  function categoryMatch(cat: SlashCategoryItem): boolean {
    if (koreanIncludes(cat.title.toLowerCase(), q)) return true;
    if (koreanIncludes(cat.description.toLowerCase(), q)) return true;
    if (cat.keywords.some((k) => koreanIncludes(k.toLowerCase(), q))) return true;
    return cat.children.some((c) => leafMatch(c));
  }

  const scored = contextFiltered
    .map((e, idx) => {
      if (e.kind === "leaf") {
        if (!leafMatch(e)) return null;
        return { entry: e as SlashMenuEntry, score: scoreLeaf(e, q), idx };
      }
      if (!categoryMatch(e)) return null;
      const childBest = e.children.reduce((best, child) => {
        if (!leafMatch(child)) return best;
        return Math.max(best, scoreLeaf(child, q));
      }, 0);
      const own = Math.max(
        scoreTextMatch(e.title, q),
        scoreTextMatch(e.description, q),
        e.keywords.reduce((best, kw) => Math.max(best, scoreTextMatch(kw, q)), 0),
      );
      return { entry: e as SlashMenuEntry, score: Math.max(own, childBest), idx };
    })
    .filter((v): v is { entry: SlashMenuEntry; score: number; idx: number } => v != null)
    .sort((a, b) => (b.score - a.score) || (a.idx - b.idx));

  return scored.map((v) => v.entry);
}

export function filterSlashLeaves(
  leaves: SlashLeafItem[],
  query: string,
): SlashLeafItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return leaves;
  return leaves
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => {
      if (koreanIncludes(item.title.toLowerCase(), q)) return true;
      return item.keywords.some((k) => koreanIncludes(k.toLowerCase(), q));
    })
    .sort((a, b) => (scoreLeaf(b.item, q) - scoreLeaf(a.item, q)) || (a.idx - b.idx))
    .map(({ item }) => item);
}