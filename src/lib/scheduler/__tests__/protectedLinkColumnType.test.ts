import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseBundle, DatabaseRowPreset } from "../../../types/database";
import { useDatabaseStore } from "../../../store/databaseStore";
import { usePageStore } from "../../../store/pageStore";
import {
  ensureLCSchedulerDatabase,
  LC_SCHEDULER_COLUMN_IDS,
  LC_SCHEDULER_DATABASE_TITLE,
  makeLCSchedulerDatabaseId,
} from "../database";
import {
  ensureLCFeatureDatabase,
  LC_FEATURE_COLUMN_IDS,
  LC_FEATURE_DATABASE_TITLE,
  makeLCFeatureDatabaseId,
} from "../featureDatabase";
import {
  ensureLCMilestoneDatabase,
  LC_MILESTONE_COLUMN_IDS,
  LC_MILESTONE_DATABASE_TITLE,
  makeLCMilestoneDatabaseId,
} from "../milestoneDatabase";
import { LC_SCHEDULER_WORKSPACE_ID } from "../scope";

const customPreset: DatabaseRowPreset = {
  id: "custom-preset",
  databaseId: "custom-db",
  name: "사용자 프리셋",
  visibleColumnIds: ["title", "custom"],
  hiddenColumnIds: [],
  columnDefaults: {},
  requiredColumnIds: ["title"],
  createdAt: 1,
  updatedAt: 1,
};

function makeSchedulerBundle(databaseId: string): DatabaseBundle {
  return {
    meta: {
      id: databaseId,
      workspaceId: LC_SCHEDULER_WORKSPACE_ID,
      title: "사용자 작업 DB",
      createdAt: 1,
      updatedAt: 1,
    },
    columns: [
      { id: LC_SCHEDULER_COLUMN_IDS.title, name: "작업명", type: "title" },
      {
        id: LC_SCHEDULER_COLUMN_IDS.feature,
        name: "피쳐",
        type: "itemFetch",
        config: {
          itemFetchSourceDatabaseId: "feature-db",
          itemFetchMatchColumnId: "task-link",
        },
      },
    ],
    presets: [{ ...customPreset, databaseId }],
    rowPageOrder: ["row-1"],
  };
}

function makeFeatureBundle(databaseId: string): DatabaseBundle {
  return {
    meta: {
      id: databaseId,
      workspaceId: LC_SCHEDULER_WORKSPACE_ID,
      title: "사용자 피처 DB",
      createdAt: 1,
      updatedAt: 1,
    },
    columns: [
      { id: LC_FEATURE_COLUMN_IDS.title, name: "피처", type: "title" },
      {
        id: LC_FEATURE_COLUMN_IDS.task,
        name: "작업",
        type: "itemFetch",
        config: {
          itemFetchSourceDatabaseId: "task-db",
          itemFetchMatchColumnId: "feature-link",
        },
      },
    ],
    presets: [],
    rowPageOrder: [],
  };
}

function makeMilestoneBundle(databaseId: string): DatabaseBundle {
  return {
    meta: {
      id: databaseId,
      workspaceId: LC_SCHEDULER_WORKSPACE_ID,
      title: "사용자 마일스톤 DB",
      createdAt: 1,
      updatedAt: 1,
    },
    columns: [
      { id: LC_MILESTONE_COLUMN_IDS.title, name: "마일스톤", type: "title" },
      { id: LC_MILESTONE_COLUMN_IDS.linkedProject, name: "연결", type: "text" },
    ],
    presets: [],
    rowPageOrder: [],
  };
}

describe("scheduler protected database column customization", () => {
  beforeEach(() => {
    useDatabaseStore.setState({
      databases: {},
      cacheWorkspaceId: LC_SCHEDULER_WORKSPACE_ID,
      migrationQuarantine: [],
      dbTemplates: {},
    });
    usePageStore.setState({
      pages: {},
      activePageId: null,
    });
  });

  it("기존 스케줄러 DB는 ensure 중 사용자 컬럼 목록과 프리셋을 덮어쓰지 않는다", async () => {
    const databaseId = makeLCSchedulerDatabaseId(LC_SCHEDULER_WORKSPACE_ID);
    const existing = makeSchedulerBundle(databaseId);
    useDatabaseStore.setState({
      databases: {
        [databaseId]: existing,
      },
    });

    await ensureLCSchedulerDatabase(LC_SCHEDULER_WORKSPACE_ID);

    const after = useDatabaseStore.getState().databases[databaseId];
    expect(after?.meta.title).toBe("사용자 작업 DB");
    expect(after?.columns).toEqual(existing.columns);
    expect(after?.presets).toEqual(existing.presets);
  });

  it("기존 스케줄러 DB의 row cell 값도 ensure 중 자동 마이그레이션하지 않는다", async () => {
    const databaseId = makeLCSchedulerDatabaseId(LC_SCHEDULER_WORKSPACE_ID);
    useDatabaseStore.setState({
      databases: {
        [databaseId]: makeSchedulerBundle(databaseId),
      },
    });
    usePageStore.setState({
      pages: {
        "row-1": {
          id: "row-1",
          workspaceId: LC_SCHEDULER_WORKSPACE_ID,
          title: "사용자 행",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 1,
          createdAt: 1,
          updatedAt: 1,
          databaseId,
          dbCells: {
            [LC_SCHEDULER_COLUMN_IDS.status]: "leave",
          },
        },
      },
      activePageId: null,
    });

    await ensureLCSchedulerDatabase(LC_SCHEDULER_WORKSPACE_ID);

    expect(usePageStore.getState().pages["row-1"]?.title).toBe("사용자 행");
    expect(usePageStore.getState().pages["row-1"]?.dbCells?.[LC_SCHEDULER_COLUMN_IDS.status]).toBe("leave");
    expect(usePageStore.getState().pages["row-1"]?.dbCells?.[LC_SCHEDULER_COLUMN_IDS.attendance]).toBeUndefined();
  });

  it("보호 DB의 기본 컬럼도 title이 아니면 타입 변경과 삭제가 가능하다", async () => {
    const databaseId = makeLCSchedulerDatabaseId(LC_SCHEDULER_WORKSPACE_ID);
    await ensureLCSchedulerDatabase(LC_SCHEDULER_WORKSPACE_ID);

    useDatabaseStore.getState().updateColumn(databaseId, LC_SCHEDULER_COLUMN_IDS.status, {
      type: "text",
      config: undefined,
    });
    expect(
      useDatabaseStore
        .getState()
        .databases[databaseId]?.columns.find((column) => column.id === LC_SCHEDULER_COLUMN_IDS.status)
        ?.type,
    ).toBe("text");

    useDatabaseStore.getState().removeColumn(databaseId, LC_SCHEDULER_COLUMN_IDS.status);
    expect(
      useDatabaseStore
        .getState()
        .databases[databaseId]?.columns.find((column) => column.id === LC_SCHEDULER_COLUMN_IDS.status),
    ).toBeUndefined();
  });

  it("원본 피처 DB의 작업 연결 컬럼도 ensure 중 itemFetch 타입을 유지한다", async () => {
    const databaseId = makeLCFeatureDatabaseId(LC_SCHEDULER_WORKSPACE_ID);
    const existing = makeFeatureBundle(databaseId);
    useDatabaseStore.setState({
      databases: {
        [databaseId]: existing,
      },
    });

    await ensureLCFeatureDatabase(LC_SCHEDULER_WORKSPACE_ID);

    const after = useDatabaseStore.getState().databases[databaseId];
    expect(after?.meta.title).toBe("사용자 피처 DB");
    expect(after?.columns).toEqual(existing.columns);
  });

  it("피처 DB 최초 생성 기본 컬럼은 작업 기간만 사용하고 작업 종료 컬럼을 만들지 않는다", async () => {
    const databaseId = makeLCFeatureDatabaseId(LC_SCHEDULER_WORKSPACE_ID);

    await ensureLCFeatureDatabase(LC_SCHEDULER_WORKSPACE_ID);

    const columns = useDatabaseStore.getState().databases[databaseId]?.columns ?? [];
    expect(columns.find((column) => column.id === LC_FEATURE_COLUMN_IDS.workStart)?.name)
      .toBe("작업 기간");
    expect(columns.find((column) => column.id === LC_FEATURE_COLUMN_IDS.workEnd))
      .toBeUndefined();
  });

  it("기존 피처 DB의 레거시 작업 기간 컬럼 구성을 보정한다", async () => {
    const databaseId = makeLCFeatureDatabaseId(LC_SCHEDULER_WORKSPACE_ID);
    useDatabaseStore.setState({
      databases: {
        [databaseId]: {
          ...makeFeatureBundle(databaseId),
          columns: [
            { id: LC_FEATURE_COLUMN_IDS.title, name: "피처", type: "title" },
            { id: LC_FEATURE_COLUMN_IDS.workStart, name: "작업시작", type: "date" },
            { id: LC_FEATURE_COLUMN_IDS.workEnd, name: "작업종료", type: "date" },
          ],
        },
      },
    });

    await ensureLCFeatureDatabase(LC_SCHEDULER_WORKSPACE_ID);

    const columns = useDatabaseStore.getState().databases[databaseId]?.columns ?? [];
    expect(columns.map((column) => column.id)).toEqual([
      LC_FEATURE_COLUMN_IDS.title,
      LC_FEATURE_COLUMN_IDS.workStart,
    ]);
    expect(columns.find((column) => column.id === LC_FEATURE_COLUMN_IDS.workStart)?.name)
      .toBe("작업 기간");
  });

  it("마일스톤 DB의 기본 컬럼 타입 변경도 ensure 중 유지한다", async () => {
    const databaseId = makeLCMilestoneDatabaseId(LC_SCHEDULER_WORKSPACE_ID);
    const existing = makeMilestoneBundle(databaseId);
    useDatabaseStore.setState({
      databases: {
        [databaseId]: existing,
      },
    });

    await ensureLCMilestoneDatabase(LC_SCHEDULER_WORKSPACE_ID);

    const after = useDatabaseStore.getState().databases[databaseId];
    expect(after?.meta.title).toBe("사용자 마일스톤 DB");
    expect(after?.columns).toEqual(existing.columns);
  });

  it("보호 DB가 없을 때는 최초 생성용 기본 컬럼을 만든다", async () => {
    const schedulerId = makeLCSchedulerDatabaseId(LC_SCHEDULER_WORKSPACE_ID);
    const featureId = makeLCFeatureDatabaseId(LC_SCHEDULER_WORKSPACE_ID);
    const milestoneId = makeLCMilestoneDatabaseId(LC_SCHEDULER_WORKSPACE_ID);

    await ensureLCSchedulerDatabase(LC_SCHEDULER_WORKSPACE_ID);
    await ensureLCFeatureDatabase(LC_SCHEDULER_WORKSPACE_ID);
    await ensureLCMilestoneDatabase(LC_SCHEDULER_WORKSPACE_ID);

    expect(useDatabaseStore.getState().databases[schedulerId]?.meta.title).toBe(LC_SCHEDULER_DATABASE_TITLE);
    expect(useDatabaseStore.getState().databases[featureId]?.meta.title).toBe(LC_FEATURE_DATABASE_TITLE);
    expect(useDatabaseStore.getState().databases[milestoneId]?.meta.title).toBe(LC_MILESTONE_DATABASE_TITLE);
  });
});
