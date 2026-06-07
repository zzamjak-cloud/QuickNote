import { beforeEach, describe, expect, it } from "vitest";
import { applyRemoteDatabaseToStore, applyRemoteDatabasesToStore } from "../storeApply";
import { useDatabaseStore } from "../../../store/databaseStore";
import type { GqlDatabase } from "../queries/database";
import {
  LC_MILESTONE_DATABASE_ID,
  LC_SCHEDULER_DATABASE_ID,
  LC_SCHEDULER_DATABASE_TITLE,
} from "../../scheduler/database";
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

  it("remote templates를 dbTemplates에 복원한다", () => {
    applyRemoteDatabaseToStore({
      ...remoteDatabase(),
      templates: JSON.stringify([
        {
          id: "template-1",
          title: "QA 템플릿",
          cells: { status: "todo" },
          pageId: "template-page-1",
        },
      ]),
    });

    expect(useDatabaseStore.getState().dbTemplates["db-1"]).toEqual([
      {
        id: "template-1",
        title: "QA 템플릿",
        cells: { status: "todo" },
        pageId: "template-page-1",
      },
    ]);
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

  it("LC 스케줄러 DB 의 표시설정(viewConfigs)은 일반 LWW 로 동기화된다", () => {
    // 시드는 고정 과거 타임스탬프라 로컬이 항상 원격 편집보다 오래됨 → 원격(더 최신)이 적용된다.
    // 별도 보호 DB 특수처리 없이 일반 DB 와 동일하게 동기화되어야 한다.
    useDatabaseStore.setState({
      databases: {
        [LC_MILESTONE_DATABASE_ID]: {
          meta: {
            id: LC_MILESTONE_DATABASE_ID,
            workspaceId: LC_SCHEDULER_WORKSPACE_ID,
            title: "마일스톤",
            createdAt: Date.parse("2020-01-01T00:00:00.000Z"),
            // 시드의 고정 과거 타임스탬프.
            updatedAt: Date.parse("2020-01-01T00:00:00.000Z"),
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
      // 원격은 더 최신(remoteDatabase()의 updatedAt=2026-01-01) + viewConfigs 보유.
      panelState: JSON.stringify({
        viewConfigs: {
          timeline: { hiddenColumnIds: ["source"] },
        },
      }),
    });

    const bundle = useDatabaseStore.getState().databases[LC_MILESTONE_DATABASE_ID];
    expect(bundle.panelState?.viewConfigs?.timeline?.hiddenColumnIds).toEqual(["source"]);
  });

  it("로컬 편집이 더 최신이면 오래된 원격이 표시설정을 되돌리지 않는다(LWW)", () => {
    // 사용자가 방금 표시설정을 바꿔 로컬 updatedAt 이 최신인 상태에서, 오래된 원격 스냅샷이
    // 도착해도 로컬 변경을 덮지 않아야 한다(되돌림 방지).
    useDatabaseStore.setState({
      databases: {
        [LC_MILESTONE_DATABASE_ID]: {
          meta: {
            id: LC_MILESTONE_DATABASE_ID,
            workspaceId: LC_SCHEDULER_WORKSPACE_ID,
            title: "마일스톤",
            createdAt: Date.parse("2020-01-01T00:00:00.000Z"),
            // 원격(2026-01-01)보다 최신 → 로컬 편집 보존.
            updatedAt: Date.parse("2026-06-01T00:00:00.000Z"),
          },
          columns: [
            { id: "title", name: "Name", type: "title" },
            { id: "source", name: "Source", type: "select" },
          ],
          presets: [],
          panelState: {
            ...emptyPanelState(),
            viewConfigs: { timeline: { hiddenColumnIds: ["source"] } },
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
      // 오래된 원격 — 표시설정 없음.
      panelState: JSON.stringify({}),
    });

    const bundle = useDatabaseStore.getState().databases[LC_MILESTONE_DATABASE_ID];
    // 로컬의 최신 표시설정이 그대로 보존됨.
    expect(bundle.panelState?.viewConfigs?.timeline?.hiddenColumnIds).toEqual(["source"]);
  });

  it("배치(batch) 경로도 remote panelState(구성원 순서·표시설정)를 보존한다", () => {
    // reconcileLCSchedulerRemoteSnapshot(전체 페치/새로고침)는 batch 경로를 쓴다.
    // 과거 이 경로가 panelState 를 누락해 새로고침 시 스케줄러 구성원 순서·표시설정이 사라졌다.
    applyRemoteDatabasesToStore([
      {
        ...remoteDatabase(),
        panelState: JSON.stringify({
          schedulerMemberOrder: ["member-3", "member-1", "member-2"],
          viewConfigs: { timeline: { hiddenColumnIds: ["source"] } },
        }),
      },
    ]);

    const bundle = useDatabaseStore.getState().databases["db-1"];
    expect(bundle.panelState?.schedulerMemberOrder).toEqual([
      "member-3",
      "member-1",
      "member-2",
    ]);
    expect(bundle.panelState?.viewConfigs?.timeline?.hiddenColumnIds).toEqual(["source"]);
  });

  it("LC 작업 DB는 로컬 DB updatedAt 이 더 최신이어도 더 최신 구성원 순서만 병합한다", () => {
    useDatabaseStore.setState({
      databases: {
        [LC_SCHEDULER_DATABASE_ID]: {
          meta: {
            id: LC_SCHEDULER_DATABASE_ID,
            workspaceId: LC_SCHEDULER_WORKSPACE_ID,
            title: LC_SCHEDULER_DATABASE_TITLE,
            createdAt: Date.parse("2026-01-01T00:00:00.000Z"),
            updatedAt: Date.parse("2026-06-02T00:00:00.000Z"),
          },
          columns: [{ id: "title", name: "Name", type: "title" }],
          presets: [],
          panelState: {
            ...emptyPanelState(),
            schedulerMemberOrder: ["local-1", "local-2"],
            schedulerMemberOrderUpdatedAt: 100,
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
      id: LC_SCHEDULER_DATABASE_ID,
      workspaceId: LC_SCHEDULER_WORKSPACE_ID,
      title: LC_SCHEDULER_DATABASE_TITLE,
      updatedAt: "2026-06-01T00:00:00.000Z",
      panelState: JSON.stringify({
        schedulerMemberOrder: ["remote-2", "remote-1"],
        schedulerMemberOrderUpdatedAt: 200,
      }),
    });

    const bundle = useDatabaseStore.getState().databases[LC_SCHEDULER_DATABASE_ID];
    expect(bundle.panelState?.schedulerMemberOrder).toEqual(["remote-2", "remote-1"]);
    expect(bundle.panelState?.schedulerMemberOrderUpdatedAt).toBe(200);
    expect(bundle.meta.updatedAt).toBe(Date.parse("2026-06-02T00:00:00.000Z"));
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
