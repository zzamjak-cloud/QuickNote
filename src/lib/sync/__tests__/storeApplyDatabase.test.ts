import { beforeEach, describe, expect, it } from "vitest";
import { applyRemoteDatabaseToStore } from "../storeApply";
import { useDatabaseStore } from "../../../store/databaseStore";
import type { GqlDatabase } from "../queries/database";
import { LC_MILESTONE_DATABASE_ID } from "../../scheduler/database";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../scheduler/scope";
import { emptyPanelState } from "../../../types/database";

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
    expect(bundle.columns.find((column) => column.id === "qa-period")?.config?.timelineCard).toEqual({
      enabled: true,
      titleMode: "custom",
      title: "QA",
      color: "#2563EB",
    });
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

  it("보호 DB(마일스톤/피처)의 원격 viewConfigs 표시 설정을 로컬에 병합한다", () => {
    // 보호 DB 는 각 클라이언트가 비결정 시드 timestamp 로 재구성되어 로컬 updatedAt 이
    // 원격보다 최신일 수 있다 → 일반 LWW 경로가 막힌다. 이 상황에서도 일정 카드 속성
    // 표시 설정(viewConfigs.timeline)은 원격값으로 동기화되어야 한다.
    useDatabaseStore.setState({
      databases: {
        [LC_MILESTONE_DATABASE_ID]: {
          meta: {
            id: LC_MILESTONE_DATABASE_ID,
            workspaceId: LC_SCHEDULER_WORKSPACE_ID,
            title: "마일스톤",
            createdAt: 1,
            // 원격(2026-01-01T00:00:01)보다 최신 → LWW 가드가 일반 경로를 막는다.
            updatedAt: Date.parse("2030-01-01T00:00:00.000Z"),
          },
          columns: [
            { id: "title", name: "Name", type: "title" },
            { id: "source", name: "Source", type: "select" },
          ],
          presets: [],
          // 로컬은 표시 설정이 없어 전체 컬럼이 보이는 상태("모두 활성화").
          panelState: undefined,
          rowPageOrder: [],
        },
      },
      cacheWorkspaceId: "ws-1",
      migrationQuarantine: [],
      dbTemplates: {},
    });

    applyRemoteDatabaseToStore({
      ...remoteDatabase(),
      id: LC_MILESTONE_DATABASE_ID,
      workspaceId: LC_SCHEDULER_WORKSPACE_ID,
      panelState: JSON.stringify({
        viewConfigs: {
          timeline: { hiddenColumnIds: ["source"] },
        },
      }),
    });

    const bundle = useDatabaseStore.getState().databases[LC_MILESTONE_DATABASE_ID];
    expect(bundle.panelState?.viewConfigs?.timeline?.hiddenColumnIds).toEqual(["source"]);
  });

  it("보호 DB 원격이 더 최신이어도 로컬 필터 프리셋을 viewConfigs 병합 과정에서 잃지 않는다", () => {
    // 원격이 로컬보다 최신(LWW 통과) → 일반 경로 진입. 원격은 viewConfigs 만, 로컬은
    // 필터 프리셋만 보유한 상황에서 둘 다 보존되어야 한다.
    useDatabaseStore.setState({
      databases: {
        [LC_MILESTONE_DATABASE_ID]: {
          meta: {
            id: LC_MILESTONE_DATABASE_ID,
            workspaceId: LC_SCHEDULER_WORKSPACE_ID,
            title: "마일스톤",
            createdAt: 1,
            // 원격(2026-01-01)보다 과거 → 원격이 더 최신으로 판정되어 일반 경로로 진입.
            updatedAt: Date.parse("2020-01-01T00:00:00.000Z"),
          },
          columns: [
            { id: "title", name: "Name", type: "title" },
            { id: "source", name: "Source", type: "select" },
          ],
          presets: [],
          panelState: {
            ...emptyPanelState(),
            filterPresets: [
              { id: "p-local", name: "로컬탭", filterRules: [], sortRules: [] },
            ],
          },
          rowPageOrder: [],
        },
      },
      cacheWorkspaceId: "ws-1",
      migrationQuarantine: [],
      dbTemplates: {},
    });

    applyRemoteDatabaseToStore({
      ...remoteDatabase(),
      id: LC_MILESTONE_DATABASE_ID,
      workspaceId: LC_SCHEDULER_WORKSPACE_ID,
      panelState: JSON.stringify({
        viewConfigs: { timeline: { hiddenColumnIds: ["source"] } },
      }),
    });

    const bundle = useDatabaseStore.getState().databases[LC_MILESTONE_DATABASE_ID];
    // 원격 viewConfigs 채택 + 로컬 필터 프리셋 보존.
    expect(bundle.panelState?.viewConfigs?.timeline?.hiddenColumnIds).toEqual(["source"]);
    expect(bundle.panelState?.filterPresets?.[0]?.id).toBe("p-local");
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
