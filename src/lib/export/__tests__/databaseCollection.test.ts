import { beforeEach, describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/react";
import { useDatabaseStore } from "../../../store/databaseStore";
import { usePageStore } from "../../../store/pageStore";
import { collectDatabaseCollection } from "../databaseCollection";
import type { ColumnDef } from "../../../types/database";

const emptyDoc: JSONContent = { type: "doc", content: [] };

function makePage(id: string, title: string, dbCells: Record<string, unknown>) {
  return {
    id,
    title,
    icon: null,
    doc: emptyDoc,
    parentId: null,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    databaseId: "db-1",
    dbCells,
  };
}

describe("collectDatabaseCollection", () => {
  beforeEach(() => {
    useDatabaseStore.setState({ databases: {} });
    usePageStore.setState({ pages: {}, activePageId: null });
  });

  it("DB 가 없으면 null 을 반환한다", () => {
    expect(collectDatabaseCollection("missing")).toBeNull();
  });

  it("컬럼이 없으면 null 을 반환한다", () => {
    useDatabaseStore.setState({
      databases: {
        "db-1": {
          meta: { id: "db-1", title: "DB", createdAt: 1, updatedAt: 1 },
          columns: [],
          rowPageOrder: [],
        },
      },
    });
    expect(collectDatabaseCollection("db-1")).toBeNull();
  });

  it("헤더(컬럼명)와 행(title + 셀 표시값)을 모은다", () => {
    const columns: ColumnDef[] = [
      { id: "c-title", name: "이름", type: "title" },
      { id: "c-num", name: "수량", type: "number" },
      { id: "c-text", name: "메모", type: "text" },
    ];
    useDatabaseStore.setState({
      databases: {
        "db-1": {
          meta: { id: "db-1", title: "DB", createdAt: 1, updatedAt: 1 },
          columns,
          rowPageOrder: ["p-1", "p-2", "p-missing"],
        },
      },
    });
    usePageStore.setState({
      pages: {
        "p-1": makePage("p-1", "행 하나", { "c-num": 3, "c-text": "첫 메모" }),
        "p-2": makePage("p-2", "행 둘", { "c-num": 7, "c-text": "둘째 메모" }),
      },
      activePageId: null,
    });

    const result = collectDatabaseCollection("db-1");
    expect(result).not.toBeNull();
    expect(result?.headers).toEqual(["이름", "수량", "메모"]);
    // p-missing 은 page 가 없으므로 건너뛴다.
    expect(result?.rows).toEqual([
      ["행 하나", "3", "첫 메모"],
      ["행 둘", "7", "둘째 메모"],
    ]);
  });
});
