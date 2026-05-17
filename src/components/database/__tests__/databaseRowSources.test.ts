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
});
