import { describe, it, expect } from "vitest";
import { getFirstRootSidebarPageId } from "../../lib/sync/workspaceLanding";
import type { Page, PageMap } from "../../types/page";

const emptyDoc = { type: "doc" as const, content: [{ type: "paragraph" as const }] };

function makePage(over: Partial<Page> & Pick<Page, "id" | "order">): Page {
  return {
    title: "t",
    icon: null,
    doc: emptyDoc,
    parentId: null,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

describe("getFirstRootSidebarPageId", () => {
  it("루트 일반 페이지 중 order 가 가장 작은 id 를 반환한다", () => {
    const pages: PageMap = {
      a: makePage({ id: "a", order: 2 }),
      b: makePage({ id: "b", order: 0 }),
      c: makePage({ id: "c", order: 1 }),
    };
    expect(getFirstRootSidebarPageId(pages)).toBe("b");
  });

  it("자식 페이지만 있으면 null", () => {
    const pages: PageMap = {
      child: makePage({ id: "child", parentId: "p", order: 0 }),
    };
    expect(getFirstRootSidebarPageId(pages)).toBeNull();
  });

  it("databaseId 가 있으면(행 페이지) 제외", () => {
    const pages: PageMap = {
      row: makePage({
        id: "row",
        order: 0,
        databaseId: "db1",
      }),
      normal: makePage({ id: "normal", order: 1 }),
    };
    expect(getFirstRootSidebarPageId(pages)).toBe("normal");
  });
});
