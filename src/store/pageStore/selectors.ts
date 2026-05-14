// pageStore 트리 셀렉터·필터 — 순수 함수.
// pageStore.ts 에서 분리 — 동작 변경 없음.

import type { Page } from "../../types/page";
import type { PageStore } from "../pageStore";

/** 사이드바/트리에서 숨기는 DB 전용 풀페이지 홈 — 랜딩 기본값 계산에도 동일 규칙 적용 */
export function isFullPageDatabaseHomePage(page: Page): boolean {
  const first = page.doc?.content?.[0] as
    | { type?: string; attrs?: Record<string, unknown> }
    | undefined;
  return (
    !!first &&
    first.type === "databaseBlock" &&
    first.attrs?.layout === "fullPage" &&
    typeof first.attrs?.databaseId === "string"
  );
}

/**
 * 페이지 자체 또는 조상 중 하나라도 사이드바에서 숨기는 페이지(DB 행 페이지, DB 전용 홈 페이지)
 * 가 있는지 검사. DB 항목 내부에서 생성한 자식 페이지를 사이드바·트리·검색에서 모두 숨기기 위함.
 */
function isHiddenInSidebar(
  page: Page,
  pages: Record<string, Page>,
): boolean {
  let cursor: Page | undefined = page;
  // 순환 안전장치
  const seen = new Set<string>();
  while (cursor) {
    if (seen.has(cursor.id)) break;
    seen.add(cursor.id);
    if (cursor.databaseId != null) return true;
    if (isFullPageDatabaseHomePage(cursor)) return true;
    cursor = cursor.parentId ? pages[cursor.parentId] : undefined;
  }
  return false;
}

export function selectSortedPages(state: PageStore): Page[] {
  return Object.values(state.pages)
    .filter((p) => !isHiddenInSidebar(p, state.pages))
    .sort((a, b) => a.order - b.order);
}

export type PageNode = Page & { children: PageNode[] };

// 트리 셀렉터: parentId 기반 재귀 빌드. 형제들은 order로 정렬.
export function selectPageTree(state: PageStore): PageNode[] {
  const byParent = new Map<string | null, Page[]>();
  for (const p of Object.values(state.pages)) {
    if (isHiddenInSidebar(p, state.pages)) continue; // DB 행/홈 페이지와 그 자식은 트리에서 제외
    const list = byParent.get(p.parentId) ?? [];
    list.push(p);
    byParent.set(p.parentId, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.order - b.order);
  }
  const build = (parentId: string | null): PageNode[] =>
    (byParent.get(parentId) ?? []).map((p) => ({
      ...p,
      children: build(p.id),
    }));
  return build(null);
}

/**
 * 검색 결과에서 숨기는 페이지 판정.
 * 트리와 달리 검색에선 DB 항목 페이지도 포함하고, fullPage DB 홈 페이지만 숨긴다.
 */
function isHiddenFromSearch(page: Page, pages: Record<string, Page>): boolean {
  let cursor: Page | undefined = page;
  const seen = new Set<string>();
  while (cursor) {
    if (seen.has(cursor.id)) break;
    seen.add(cursor.id);
    if (isFullPageDatabaseHomePage(cursor)) return true;
    cursor = cursor.parentId ? pages[cursor.parentId] : undefined;
  }
  return false;
}

// 검색 필터: 매치되는 페이지와 그 조상을 함께 반환.
export function filterPageTree(
  state: PageStore,
  query: string,
): PageNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return selectPageTree(state);
  const matched = new Set<string>();
  for (const p of Object.values(state.pages)) {
    // 검색 시에는 DB 항목 페이지도 포함; fullPage DB 홈 페이지만 제외
    if (isHiddenFromSearch(p, state.pages)) continue;
    if (p.title.toLowerCase().includes(q)) matched.add(p.id);
  }
  // 매치된 페이지의 표시 가능한 조상 포함.
  const include = new Set(matched);
  for (const id of matched) {
    let cursor: string | null = state.pages[id]?.parentId ?? null;
    while (cursor) {
      const parent = state.pages[cursor];
      if (!parent) break;
      if (!isHiddenFromSearch(parent, state.pages)) {
        include.add(cursor);
      }
      cursor = parent.parentId;
    }
  }
  const visiblePages = Object.values(state.pages)
    .filter((p) => include.has(p.id))
    .filter((p) => !isHiddenFromSearch(p, state.pages))
    .sort((a, b) => a.order - b.order);
  const visibleIds = new Set(visiblePages.map((p) => p.id));
  const byParent = new Map<string | null, Page[]>();
  for (const p of visiblePages) {
    const parentId =
      p.parentId && visibleIds.has(p.parentId) ? p.parentId : null;
    const list = byParent.get(parentId) ?? [];
    list.push(p);
    byParent.set(parentId, list);
  }
  const build = (parentId: string | null): PageNode[] =>
    (byParent.get(parentId) ?? []).map((p) => ({
      ...p,
      children: build(p.id),
    }));
  return build(null);
}
