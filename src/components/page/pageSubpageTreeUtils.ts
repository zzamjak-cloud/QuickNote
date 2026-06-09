import type { Page, PageMap } from "../../types/page";

export type PageTreeRow = {
  page: Page;
  depth: number;
  hasChildren: boolean;
};

type BuildPageTreeRowsOptions = {
  includeRoot?: boolean;
  isCollapsed?: (pageId: string) => boolean;
  shouldIncludePage?: (page: Page) => boolean;
};

function buildChildrenByParent(pages: PageMap): Map<string, Page[]> {
  const childrenByParent = new Map<string, Page[]>();
  for (const page of Object.values(pages)) {
    if (!page.parentId) continue;
    const list = childrenByParent.get(page.parentId) ?? [];
    list.push(page);
    childrenByParent.set(page.parentId, list);
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  }
  return childrenByParent;
}

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

export function buildPageTreeRows(
  rootPageId: string,
  pages: PageMap,
  options: BuildPageTreeRowsOptions = {},
): PageTreeRow[] {
  if (!pages[rootPageId]) return [];
  const includeRoot = options.includeRoot ?? true;
  const isCollapsed = options.isCollapsed ?? (() => false);
  const shouldIncludePage = options.shouldIncludePage ?? (() => true);
  const childrenByParent = buildChildrenByParent(pages);
  const rows: PageTreeRow[] = [];
  const seen = new Set<string>();

  const visit = (pageId: string, depth: number) => {
    const page = pages[pageId];
    if (!page || seen.has(pageId)) return;
    seen.add(pageId);
    const children = (childrenByParent.get(pageId) ?? []).filter(shouldIncludePage);
    if (includeRoot || depth > 0) {
      rows.push({
        page,
        depth: includeRoot ? depth : Math.max(0, depth - 1),
        hasChildren: children.length > 0,
      });
    }
    if (isCollapsed(pageId)) return;
    for (const child of children) visit(child.id, depth + 1);
  };

  visit(rootPageId, 0);
  return rows;
}

export function countPageDescendants(rootPageId: string, pages: PageMap): number {
  return buildPageTreeRows(rootPageId, pages, { includeRoot: false }).length;
}

export function collectPageTreePath(
  pageId: string,
  pages: PageMap,
  stopAtPageId?: string | null,
): string[] {
  const path: string[] = [];
  let cursor = pages[pageId];
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    path.unshift(cursor.id);
    if (stopAtPageId && cursor.id === stopAtPageId) break;
    seen.add(cursor.id);
    cursor = cursor.parentId ? pages[cursor.parentId] : undefined;
  }
  if (stopAtPageId && path[0] !== stopAtPageId) return [];
  return path;
}

export function findPageTreeDatabaseContext(
  pageId: string,
  pages: PageMap,
): { databaseId: string; rowPageId: string } | null {
  let cursor = pages[pageId];
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    if (cursor.databaseId) {
      return { databaseId: cursor.databaseId, rowPageId: cursor.id };
    }
    seen.add(cursor.id);
    cursor = cursor.parentId ? pages[cursor.parentId] : undefined;
  }
  return null;
}
