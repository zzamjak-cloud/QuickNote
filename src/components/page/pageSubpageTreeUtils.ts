import type { Page, PageMap } from "../../types/page";

export function findPageTreeRootId(currentPageId: string | null, pages: PageMap): string | null {
  if (!currentPageId || !pages[currentPageId]) return null;
  let cursor: Page | undefined = pages[currentPageId];
  const seen = new Set<string>();
  while (cursor?.parentId && pages[cursor.parentId] && !seen.has(cursor.parentId)) {
    seen.add(cursor.id);
    cursor = pages[cursor.parentId];
  }
  return cursor?.id ?? currentPageId;
}

export function countPageDescendants(rootPageId: string, pages: PageMap): number {
  const childrenByParent = new Map<string, Page[]>();
  for (const page of Object.values(pages)) {
    if (!page.parentId) continue;
    const list = childrenByParent.get(page.parentId) ?? [];
    list.push(page);
    childrenByParent.set(page.parentId, list);
  }
  let count = 0;
  const visit = (parentId: string): void => {
    const children = childrenByParent.get(parentId) ?? [];
    for (const child of children) {
      count += 1;
      visit(child.id);
    }
  };
  visit(rootPageId);
  return count;
}
