import { describe, expect, it } from "vitest";
import { toGqlDatabase } from "../helpers";
import type {
  ColumnDef,
  DatabaseMeta,
  DatabasePanelState,
  DatabaseRowPreset,
} from "../../../types/database";

describe("databaseStore GraphQL serialization", () => {
  it("DB column config와 preset을 AWSJSON payload로 정규화해 직렬화한다", () => {
    const meta: DatabaseMeta = {
      id: "db-1",
      workspaceId: "ws-1",
      title: "DB",
      createdAt: Date.parse("2026-01-01T00:00:00.000Z"),
      updatedAt: Date.parse("2026-01-01T00:00:01.000Z"),
    };
    const columns: ColumnDef[] = [
      { id: "title", name: "Name", type: "title" },
      {
        id: "source",
        name: "Source",
        type: "select",
        icon: "lucide:Circle:#0EA5E9",
        width: 160,
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
      {
        id: "qa-period",
        name: "QA Period",
        type: "date",
        config: {
          timelineCard: {
            enabled: true,
            titleMode: "custom",
            title: "QA",
            color: "#2563EB",
          },
        },
      },
    ];
    const presets: DatabaseRowPreset[] = [
      {
        id: "preset-1",
        databaseId: "db-1",
        name: "Feature",
        scope: "project",
        scopeId: "project-1",
        columnDefaults: { source: "todo" },
        requiredColumnIds: ["title"],
        visibleColumnIds: ["title", "source"],
        hiddenColumnIds: ["fetch"],
        schedulerDefaults: { titlePrefix: "[Feature]" },
        createdAt: 1,
        updatedAt: 2,
      },
    ];

    const payload = toGqlDatabase(meta, columns, "member-1", presets);

    expect(payload.columns).toEqual(expect.any(String));
    expect(payload.presets).toEqual(expect.any(String));
    const parsedColumns = JSON.parse(payload.columns as string) as ColumnDef[];
    const parsedPresets = JSON.parse(payload.presets as string) as DatabaseRowPreset[];
    expect(parsedColumns.find((column) => column.id === "source")?.config?.sourceFromDb).toEqual({
      databaseId: "source-db",
      columnId: "status",
      automation: true,
      viaPageLinkColumnId: "feature-link",
    });
    expect(parsedColumns.find((column) => column.id === "fetch")?.type).toBe("itemFetch");
    expect(parsedColumns.find((column) => column.id === "fetch")?.config?.itemFetchSourceDatabaseId).toBe("feature-db");
    expect(parsedColumns.find((column) => column.id === "qa-period")?.config?.timelineCard).toEqual({
      enabled: true,
      titleMode: "custom",
      title: "QA",
      color: "#2563EB",
    });
    expect(parsedPresets[0]?.schedulerDefaults?.titlePrefix).toBe("[Feature]");
  });

  it("invalid column payload는 서버 동기화 전에 거부한다", () => {
    const meta: DatabaseMeta = {
      id: "db-1",
      workspaceId: "ws-1",
      title: "DB",
      createdAt: 1,
      updatedAt: 2,
    };

    expect(() =>
      toGqlDatabase(
        meta,
        [{ id: "bad", name: "Bad", type: "unknown" } as unknown as ColumnDef],
        "member-1",
      ),
    ).toThrow("Invalid database columns");
  });

  it("원본 DB 필터 프리셋 탭 상태를 AWSJSON payload로 직렬화한다", () => {
    const meta: DatabaseMeta = {
      id: "db-1",
      workspaceId: "ws-1",
      title: "DB",
      createdAt: Date.parse("2026-01-01T00:00:00.000Z"),
      updatedAt: Date.parse("2026-01-01T00:00:01.000Z"),
    };
    const panelState: DatabasePanelState = {
      searchQuery: "",
      filterRules: [],
      sortColumnId: null,
      sortDir: "asc",
      sortRules: [],
      kanbanGroupColumnId: null,
      galleryCoverColumnId: null,
      timelineDateColumnId: null,
      viewConfigs: {},
      hiddenViewKinds: [],
      filterPresets: [
        {
          id: "preset-tab-1",
          name: "검토",
          filterRules: [{ id: "rule-1", columnId: "status", operator: "equals", value: "review" }],
          sortRules: [{ columnId: "title", dir: "asc" }],
        },
      ],
      activePresetId: "preset-tab-1",
    };

    const payload = toGqlDatabase(
      meta,
      [{ id: "title", name: "Name", type: "title" }],
      "member-1",
      [],
      panelState,
    );

    expect(payload.panelState).toEqual(expect.any(String));
    const parsedPanelState = JSON.parse(payload.panelState as string) as DatabasePanelState;
    expect(parsedPanelState.activePresetId).toBe("preset-tab-1");
    expect(parsedPanelState.filterPresets?.[0]?.filterRules).toEqual([
      { id: "rule-1", columnId: "status", operator: "equals", value: "review" },
    ]);
  });
});
