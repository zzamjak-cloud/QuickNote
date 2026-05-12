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
  // 컬럼 안: 컬럼·표·탭 차단 (중첩·너비 충돌)
  column: ["columnLayout", "table", "tabBlock"],
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

// 한국어 초성 목록 (Unicode 자모 순서)
const CHOSUNG = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

function getChosung(c: string): string {
  const code = c.charCodeAt(0);
  if (code >= 0xAC00 && code <= 0xD7A3)
    return CHOSUNG[Math.floor((code - 0xAC00) / 588)] ?? c;
  return c;
}

/** 마지막 음절의 받침 제거 — IME 조합 중 상태 처리 (예: "펭" → "페") */
function stripLastJongseong(s: string): string {
  const last = s.charCodeAt(s.length - 1);
  if (last < 0xAC00 || last > 0xD7A3) return s;
  const jongseong = (last - 0xAC00) % 28;
  if (jongseong === 0) return s;
  return s.slice(0, -1) + String.fromCharCode(last - jongseong);
}

/** 자음만으로 구성된 문자열인지 검사 (초성 검색용) */
function isAllChosung(s: string): boolean {
  return s.length > 0 && Array.from(s).every((c) => {
    const code = c.charCodeAt(0);
    return code >= 0x3131 && code <= 0x314E;
  });
}

/**
 * 한국어 포함 검색:
 * 1. 직접 포함 매칭
 * 2. 마지막 받침 제거 후 매칭 (IME 조합 중: "펭" → "페")
 * 3. 초성만 입력한 경우 초성 매칭 (예: "ㅍ" → "페이지")
 */
function koreanIncludes(text: string, query: string): boolean {
  if (text.includes(query)) return true;
  const stripped = stripLastJongseong(query);
  if (stripped !== query && text.includes(stripped)) return true;
  if (isAllChosung(query)) {
    const titleChosung = Array.from(text).map(getChosung).join('');
    if (titleChosung.includes(query)) return true;
  }
  return false;
}

/** 루트 목록만 필터 (서브메뉴는 SlashMenu 내부에서 처리) */
export function filterSlashMenuEntries(query: string, editor?: Editor): SlashMenuEntry[] {
  const allEntries = getSlashMenuEntries();
  const blocked = editor ? getBlockedIds(editor) : new Set<string>();

  const isLeafBlocked = (item: SlashLeafItem) =>
    item.id !== undefined && blocked.has(item.id);

  // 컨텍스트 필터 적용
  const contextFiltered: SlashMenuEntry[] = blocked.size === 0
    ? allEntries
    : allEntries.flatMap<SlashMenuEntry>((e) => {
        if (e.kind === "leaf") return isLeafBlocked(e) ? [] : [e];
        const children = e.children.filter((c) => !isLeafBlocked(c));
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

  return contextFiltered.filter((e) => {
    if (e.kind === "leaf") return leafMatch(e);
    return categoryMatch(e);
  });
}

export function filterSlashLeaves(
  leaves: SlashLeafItem[],
  query: string,
): SlashLeafItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return leaves;
  return leaves.filter((item) => {
    if (koreanIncludes(item.title.toLowerCase(), q)) return true;
    return item.keywords.some((k) => koreanIncludes(k.toLowerCase(), q));
  });
}

/** @deprecated filterSlashMenuEntries 사용 */
export function filterSlashItems(query: string): SlashLeafItem[] {
  const filtered = filterSlashMenuEntries(query);
  const out: SlashLeafItem[] = [];
  for (const e of filtered) {
    if (e.kind === "leaf") out.push(e);
    else out.push(...e.children);
  }
  return out;
}
