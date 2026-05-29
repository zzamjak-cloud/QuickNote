import { beforeEach, describe, expect, it } from "vitest";
import { applyRemoteDatabaseToStore } from "../storeApply";
import { useDatabaseStore } from "../../../store/databaseStore";
import type { GqlDatabase } from "../queries/database";

function remoteDatabase(): GqlDatabase {
  return {
    id: "db-1",
    workspaceId: "ws-1",
    createdByMemberId: "member-1",
    title: "DB",
    columns: JSON.stringify([
      { id: "title", name: "Name", type: "title" },
      {
        id: "source",
        name: "Source",
        type: "select",
        icon: "lucide:Circle:#0EA5E9",
        config: {
          sourceFromDb: {
            databaseId: "source-db",
            columnId: "status",
            automation: true,
            viaPageLinkColumnId: "feature-link",
          },
        },
      },
      {
        id: "fetch",
        name: "Fetch",
        type: "itemFetch",
        config: {
          itemFetchSourceDatabaseId: "feature-db",
          itemFetchMatchColumnId: "feature-name",
        },
      },
    ]),
    presets: "[]",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    deletedAt: null,
  };
}

describe("applyRemoteDatabaseToStore", () => {
  beforeEach(() => {
    useDatabaseStore.setState({
      databases: {},
      cacheWorkspaceId: "ws-1",
      migrationQuarantine: [],
      dbTemplates: {},
    });
  });

  it("remote AWSJSON columns를 정규화해 advanced config를 보존한다", () => {
    applyRemoteDatabaseToStore(remoteDatabase());

    const bundle = useDatabaseStore.getState().databases["db-1"];
    expect(bundle.columns.find((column) => column.id === "source")?.icon).toBe("lucide:Circle:#0EA5E9");
    expect(bundle.columns.find((column) => column.id === "source")?.config?.sourceFromDb?.automation).toBe(true);
    expect(bundle.columns.find((column) => column.id === "fetch")?.type).toBe("itemFetch");
    expect(bundle.columns.find((column) => column.id === "fetch")?.config?.itemFetchSourceDatabaseId).toBe("feature-db");
  });

  it("remote panelState의 원본 DB 필터 프리셋 탭을 복원한다", () => {
    applyRemoteDatabaseToStore({
      ...remoteDatabase(),
      panelState: JSON.stringify({
        filterPresets: [
          {
            id: "preset-tab-1",
            name: "검토",
            filterRules: [
              { id: "rule-1", columnId: "source", operator: "equals", value: "review" },
            ],
            sortRules: [{ columnId: "title", dir: "asc" }],
          },
        ],
        activePresetId: "preset-tab-1",
      }),
    });

    const bundle = useDatabaseStore.getState().databases["db-1"];
    expect(bundle.panelState?.activePresetId).toBe("preset-tab-1");
    expect(bundle.panelState?.filterPresets?.[0]?.filterRules).toEqual([
      { id: "rule-1", columnId: "source", operator: "equals", value: "review" },
    ]);
  });

  it("invalid remote columns는 기존 local DB를 빈 columns로 덮지 않는다", () => {
    useDatabaseStore.setState({
      databases: {
        "db-invalid": {
          meta: {
            id: "db-invalid",
            workspaceId: "ws-1",
            title: "Local",
            createdAt: 1,
            updatedAt: 1,
          },
          columns: [{ id: "title", name: "Name", type: "title" }],
          presets: [],
          rowPageOrder: ["row-1"],
        },
      },
      cacheWorkspaceId: "ws-1",
      migrationQuarantine: [],
      dbTemplates: {},
    });

    applyRemoteDatabaseToStore({
      ...remoteDatabase(),
      id: "db-invalid",
      columns: JSON.stringify([{ id: "bad", name: "Bad", type: "unknown" }]),
    });

    expect(useDatabaseStore.getState().databases["db-invalid"]?.columns).toEqual([
      { id: "title", name: "Name", type: "title" },
    ]);
    expect(useDatabaseStore.getState().databases["db-invalid"]?.rowPageOrder).toEqual(["row-1"]);
  });
});
