import { describe, it, expect } from "vitest";
import type { Page } from "../../../types/page";
import type { PageStore } from "../../pageStore";
import {
  createFilterPageTreeSelector,
  filterPageTree,
  isFullPageDatabaseHomePage,
  selectPageTree,
  selectSortedPages,
} from "../selectors";

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
    doc: { type: "doc", content: [{ type: "paragraph" }] },
    parentId,
    order,
    coverImage: null,
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  };
}

function makeStore(pages: Page[]): PageStore {
  const map: Record<string, Page> = {};
  for (const p of pages) map[p.id] = p;
  return {
    pages: map,
    activePageId: null,
    cacheWorkspaceId: null,
    migrationQuarantine: [],
    lastDeletedBatch: null,
  } as unknown as PageStore;
}

describe("pageStore/selectors", () => {
  describe("isFullPageDatabaseHomePage", () => {
    it("databaseBlock fullPage 노드면 true", () => {
      const p = makePage("a", "DB", null, 0, {
        doc: {
          type: "doc",
          content: [
            {
              type: "databaseBlock",
              attrs: { databaseId: "db1", layout: "fullPage" },
            },
          ],
        },
      });
      expect(isFullPageDatabaseHomePage(p)).toBe(true);
    });

    it("inline 레이아웃이면 false", () => {
      const p = makePage("a", "임베드", null, 0, {
        doc: {
          type: "doc",
          content: [
            {
              type: "databaseBlock",
              attrs: { databaseId: "db1", layout: "inline" },
            },
          ],
        },
      });
      expect(isFullPageDatabaseHomePage(p)).toBe(false);
    });

    it("databaseId 가 string 이 아니면 false", () => {
      const p = makePage("a", "x", null, 0, {
        doc: {
          type: "doc",
          content: [
            { type: "databaseBlock", attrs: { layout: "fullPage" } },
          ],
        },
      });
      expect(isFullPageDatabaseHomePage(p)).toBe(false);
    });
  });

  describe("selectSortedPages", () => {
    it("DB 행 페이지(databaseId 있는)는 제외", () => {
      const store = makeStore([
        makePage("a", "보통", null, 1),
        makePage("b", "행", null, 2, { databaseId: "db1" }),
      ]);
      const list = selectSortedPages(store);
      expect(list.map((p) => p.id)).toEqual(["a"]);
    });

    it("order 오름차순", () => {
      const store = makeStore([
        makePage("c", "셋째", null, 30),
        makePage("a", "첫째", null, 10),
        makePage("b", "둘째", null, 20),
      ]);
      const list = selectSortedPages(store);
      expect(list.map((p) => p.id)).toEqual(["a", "b", "c"]);
    });
  });

  describe("selectPageTree", () => {
    it("parent/child 구조를 children 으로 묶는다", () => {
      const store = makeStore([
        makePage("p", "부모", null, 0),
        makePage("c1", "자식1", "p", 0),
        makePage("c2", "자식2", "p", 1),
      ]);
      const tree = selectPageTree(store);
      expect(tree).toHaveLength(1);
      expect(tree[0]!.id).toBe("p");
      expect(tree[0]!.children.map((c) => c.id)).toEqual(["c1", "c2"]);
    });

    it("순환 참조여도 무한루프 없이 종료", () => {
      const store = makeStore([
        makePage("a", "A", "b", 0),
        makePage("b", "B", "a", 0),
      ]);
      const tree = selectPageTree(store);
      // 트리 빌드는 parentId가 양쪽에 있어 루트 노드가 없음 → 빈 배열
      expect(tree).toEqual([]);
    });
  });

  describe("filterPageTree", () => {
    it("빈 쿼리는 전체 트리", () => {
      const store = makeStore([makePage("a", "x", null, 0)]);
      expect(filterPageTree(store, "")).toHaveLength(1);
      expect(filterPageTree(store, "   ")).toHaveLength(1);
    });

    it("제목 매치 + 매치 페이지의 조상 포함", () => {
      const store = makeStore([
        makePage("p", "부모", null, 0),
        makePage("c", "특수자식", "p", 0),
        makePage("o", "다른", null, 1),
      ]);
      const result = filterPageTree(store, "특수");
      expect(result.map((n) => n.id)).toEqual(["p"]);
      expect(result[0]!.children.map((n) => n.id)).toEqual(["c"]);
    });

    it("대소문자 무시", () => {
      const store = makeStore([makePage("a", "HELLO", null, 0)]);
      expect(filterPageTree(store, "hello")).toHaveLength(1);
    });
  });

  describe("createFilterPageTreeSelector", () => {
    it("본문만 바뀐 페이지 업데이트에는 이전 트리 참조를 유지한다", () => {
      const selector = createFilterPageTreeSelector("");
      const first = selector(makeStore([makePage("a", "A", null, 0)]));
      const second = selector(
        makeStore([
          makePage("a", "A", null, 0, {
            doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "본문" }] }] },
          }),
        ]),
      );
      expect(second).toBe(first);
    });
  });
});
