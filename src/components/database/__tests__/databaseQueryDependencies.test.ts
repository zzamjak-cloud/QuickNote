import { describe, expect, it } from "vitest";
import type { ColumnDef, DatabaseBundle } from "../../../types/database";
import {
  collectDatabaseDependencyIds,
  collectPageDependencyIds,
} from "../databaseQueryDependencies";

describe("databaseQueryDependencies", () => {
  it("컬럼 config에서 현재 DB와 참조 DB id를 중복 없이 정렬한다", () => {
    const columns: ColumnDef[] = [
      { id: "title", name: "이름", type: "title" },
      {
        id: "feature",
        name: "피처",
        type: "pageLink",
        config: { pageLinkScopeDatabaseId: "db-feature" },
      },
      {
        id: "fetch",
        name: "가져오기",
        type: "itemFetch",
        config: { itemFetchSourceDatabaseId: "db-task" },
      },
      {
        id: "status",
        name: "상태",
        type: "select",
        config: {
          sourceFromDb: { databaseId: "db-status", columnId: "status" },
        },
      },
      {
        id: "status-copy",
        name: "상태 복사",
        type: "multiSelect",
        config: {
          sourceFromDb: { databaseId: "db-task", columnId: "status" },
        },
      },
    ];

    expect(collectDatabaseDependencyIds("db-current", columns)).toEqual([
      "db-current",
      "db-feature",
      "db-status",
      "db-task",
    ]);
  });

  it("행 페이지와 pageLink 형태 셀 배열에서 page dependency id를 모은다", () => {
    const columns: ColumnDef[] = [
      { id: "title", name: "이름", type: "title" },
      { id: "feature", name: "피처", type: "pageLink" },
      { id: "tags", name: "태그", type: "multiSelect" },
    ];
    const sourceDb = {
      rowPageOrder: ["source-row"],
    } as DatabaseBundle;

    expect(
      collectPageDependencyIds(
        [
          {
            pageId: "row-2",
            dbCells: {
              feature: ["linked-b", "linked-a"],
              tags: ["option-id"],
            },
          },
          {
            pageId: "row-1",
            dbCells: {
              feature: ["linked-a"],
            },
          },
        ],
        columns,
        { "db-source": sourceDb },
      ),
    ).toEqual(["linked-a", "linked-b", "row-1", "row-2", "source-row"]);
  });
});
