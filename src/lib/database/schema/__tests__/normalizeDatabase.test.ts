import { describe, expect, it } from "vitest";
import {
  normalizeColumnDef,
  normalizeDatabaseBundle,
  parseSerializedColumns,
  serializeColumns,
} from "../normalizeDatabase";

const advancedColumns = [
  { id: "title", name: "Name", type: "title" },
  {
    id: "select-source",
    name: "Status",
    type: "select",
    icon: "lucide:Circle:#0EA5E9",
    width: 160,
    config: {
      sourceFromDb: {
        databaseId: "source-db",
        columnId: "source-status",
        automation: true,
        viaPageLinkColumnId: "feature-link",
      },
      options: [{ id: "todo", label: "Todo", color: "blue" }],
    },
  },
  {
    id: "progress",
    name: "Progress",
    type: "progress",
    config: {
      progressSource: {
        databaseId: "task-db",
        columnId: "status",
        completedValue: "done",
        scope: { mode: "linkedPagesFromColumn", pageLinkColumnId: "task-link" },
      },
    },
  },
  {
    id: "item-fetch",
    name: "Feature",
    type: "itemFetch",
    config: {
      itemFetchSourceDatabaseId: "feature-db",
      itemFetchMatchColumnId: "task-link",
    },
  },
  {
    id: "page-link",
    name: "Task",
    type: "pageLink",
    config: {
      pageLinkScopeDatabaseId: "task-db",
      pageLinkMirrorColumnId: "owner",
      pageLinkAutoReverse: true,
      pageLinkReverseColumnName: "Feature",
      pageLinkAutoFill: [{ targetColumnId: "team", sourceColumnId: "team" }],
      searchFilters: [{ id: "filter-1", kind: "database", value: "task-db" }],
    },
  },
] as const;

describe("normalizeDatabase schema", () => {
  it("advanced column config를 normalize와 AWSJSON serialization 경로에서 보존한다", () => {
    const normalized = advancedColumns.map((column) => normalizeColumnDef(column));

    expect(normalized).toHaveLength(5);
    expect(normalized[1]?.icon).toBe("lucide:Circle:#0EA5E9");
    expect(normalized[1]?.width).toBe(160);
    expect(normalized[1]?.config?.sourceFromDb).toEqual({
      databaseId: "source-db",
      columnId: "source-status",
      automation: true,
      viaPageLinkColumnId: "feature-link",
    });
    expect(normalized[2]?.config?.progressSource).toEqual({
      databaseId: "task-db",
      columnId: "status",
      completedValue: "done",
      scope: { mode: "linkedPagesFromColumn", pageLinkColumnId: "task-link" },
    });
    expect(normalized[3]?.type).toBe("itemFetch");
    expect(normalized[3]?.config?.itemFetchSourceDatabaseId).toBe("feature-db");
    expect(normalized[4]?.config?.pageLinkAutoFill).toEqual([
      { targetColumnId: "team", sourceColumnId: "team" },
    ]);

    const serialized = serializeColumns(normalized);
    const parsed = parseSerializedColumns(serialized);
    expect(parsed).toEqual(normalized);
  });

  it("invalid column record가 있으면 partial database로 정규화하지 않는다", () => {
    const bundle = normalizeDatabaseBundle({
      meta: { id: "db-1", title: "DB", createdAt: 1, updatedAt: 2, workspaceId: "ws-1" },
      columns: [
        { id: "title", name: "Name", type: "title" },
        { id: "bad", name: "Bad", type: "unknown" },
      ],
      rowPageOrder: ["p1", 3, "p2"],
      presets: [],
    });

    expect(bundle).toBeNull();
  });

  it("rowPageOrder가 배열이 아니면 persisted database를 정규화하지 않는다", () => {
    const bundle = normalizeDatabaseBundle({
      meta: { id: "db-1", title: "DB", createdAt: 1, updatedAt: 2 },
      columns: [{ id: "title", name: "Name", type: "title" }],
      rowPageOrder: { "0": "p1" },
      presets: [],
    });

    expect(bundle).toBeNull();
  });
});
