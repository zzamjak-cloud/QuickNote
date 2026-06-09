import { describe, expect, it } from "vitest";
import type { Page, PageMap } from "../../../types/page";
import {
  buildPageTreeRows,
  collectPageTreePath,
  countPageDescendants,
  findPageTreeDatabaseContext,
  findPageTreeRootId,
} from "../pageSubpageTreeUtils";

function makePage(
  id: string,
  title: string,
  parentId: string | null,
  order: number,
  extra: Partial<Page> = {},
): Page {
  return {
    id,
    title,
    icon: null,
    doc: { type: "doc", content: [] },
    parentId,
    order,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  };
}

function makePages(list: Page[]): PageMap {
  return Object.fromEntries(list.map((page) => [page.id, page]));
}

describe("pageSubpageTreeUtils", () => {
  it("root부터 order/title 순서로 트리 row를 평탄화한다", () => {
    const pages = makePages([
      makePage("root", "Root", null, 0, { databaseId: "db-1" }),
      makePage("b", "B", "root", 1),
      makePage("a", "A", "root", 1),
      makePage("a-1", "A-1", "a", 0),
    ]);

    expect(
      buildPageTreeRows("root", pages).map((row) => ({
        id: row.page.id,
        depth: row.depth,
        hasChildren: row.hasChildren,
      })),
    ).toEqual([
      { id: "root", depth: 0, hasChildren: true },
      { id: "a", depth: 1, hasChildren: true },
      { id: "a-1", depth: 2, hasChildren: false },
      { id: "b", depth: 1, hasChildren: false },
    ]);
  });

  it("collapsed 페이지 아래의 자식은 숨긴다", () => {
    const pages = makePages([
      makePage("root", "Root", null, 0),
      makePage("child", "Child", "root", 0),
      makePage("grandchild", "Grandchild", "child", 0),
    ]);

    expect(
      buildPageTreeRows("root", pages, {
        isCollapsed: (pageId) => pageId === "child",
      }).map((row) => row.page.id),
    ).toEqual(["root", "child"]);
  });

  it("descendant count와 path를 계산한다", () => {
    const pages = makePages([
      makePage("root", "Root", null, 0, { databaseId: "db-1" }),
      makePage("child", "Child", "root", 0),
      makePage("grandchild", "Grandchild", "child", 0),
    ]);

    expect(countPageDescendants("root", pages)).toBe(2);
    expect(collectPageTreePath("grandchild", pages, "root")).toEqual([
      "root",
      "child",
      "grandchild",
    ]);
  });

  it("가장 가까운 DB row ancestor를 찾는다", () => {
    const pages = makePages([
      makePage("row", "Row", null, 0, { databaseId: "db-1" }),
      makePage("child", "Child", "row", 0),
      makePage("grandchild", "Grandchild", "child", 0),
    ]);

    expect(findPageTreeDatabaseContext("grandchild", pages)).toEqual({
      databaseId: "db-1",
      rowPageId: "row",
    });
  });

  it("순환 parentId가 있어도 root 탐색과 path 계산이 멈춘다", () => {
    const pages = makePages([
      makePage("a", "A", "b", 0),
      makePage("b", "B", "a", 0),
    ]);

    expect(findPageTreeRootId("a", pages)).toBe("b");
    expect(collectPageTreePath("a", pages)).toEqual(["b", "a"]);
  });
});
