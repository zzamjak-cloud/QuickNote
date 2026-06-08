import { describe, expect, it } from "vitest";
import { createDatabaseRowSourcesSelector } from "../databaseRowSources";
import type { PageStore } from "../../../store/pageStore";
import type { Page } from "../../../types/page";

const doc = { type: "doc", content: [{ type: "paragraph" }] };

function page(id: string, patch: Partial<Page> = {}): Page {
  return {
    id,
    title: id,
    icon: null,
    doc,
    parentId: null,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    databaseId: "db",
    dbCells: {},
    ...patch,
  };
}

function state(pages: Record<string, Page>): PageStore {
  return { pages } as PageStore;
}

describe("database row sources selector", () => {
  it("무관한 페이지 변경에는 같은 배열을 재사용한다", () => {
    const selector = createDatabaseRowSourcesSelector(["a"]);
    const a = page("a");
    const first = selector(state({ a, x: page("x") }));
    const second = selector(state({ a, x: page("x", { title: "changed" }) }));
    expect(second).toBe(first);
  });

  it("행 페이지 메타가 바뀌면 새 배열을 반환한다", () => {
    const selector = createDatabaseRowSourcesSelector(["a"]);
    const first = selector(state({ a: page("a") }));
    const second = selector(state({ a: page("a", { title: "A2" }) }));
    expect(second).not.toBe(first);
    expect(second[0]?.title).toBe("A2");
  });

  it("pageStore에 없는 행은 row index fallback으로 만든다", () => {
    const selector = createDatabaseRowSourcesSelector(["a"], [
      {
        pageId: "a",
        workspaceId: "ws",
        databaseId: "db",
        title: "캐시 행",
        icon: "emoji:📌",
        order: 1,
        dbCells: { col: "value" },
        updatedAt: 1,
      },
    ]);

    expect(selector(state({}))).toEqual([
      {
        pageId: "a",
        databaseId: "db",
        title: "캐시 행",
        icon: "emoji:📌",
        dbCells: { col: "value" },
      },
    ]);
  });

  it("pageStore 행이 있으면 row index fallback보다 우선한다", () => {
    const selector = createDatabaseRowSourcesSelector(["a"], [
      {
        pageId: "a",
        workspaceId: "ws",
        databaseId: "db",
        title: "캐시 행",
        icon: null,
        order: 1,
        dbCells: { col: "cached" },
        updatedAt: 1,
      },
    ]);

    const rows = selector(state({
      a: page("a", { title: "로컬 행", dbCells: { col: "local" } }),
    }));
    expect(rows[0]?.title).toBe("로컬 행");
    expect(rows[0]?.dbCells).toEqual({ col: "local" });
  });
});
