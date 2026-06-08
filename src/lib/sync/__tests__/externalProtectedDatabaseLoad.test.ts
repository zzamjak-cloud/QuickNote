import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDatabaseStore } from "../../../store/databaseStore";
import { usePageStore } from "../../../store/pageStore";
import {
  LC_SCHEDULER_DATABASE_ID,
  makeLCSchedulerDatabaseId,
} from "../../scheduler/database";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../scheduler/scope";
import { useDatabaseRowRemoteStore } from "../../../store/databaseRowRemoteStore";
import { useSchedulerViewStore } from "../../../store/schedulerViewStore";
import {
  fetchDatabaseById,
  fetchDatabaseRowIndexBatch,
  fetchDatabaseRowsBatch,
  fetchDatabasesByWorkspace,
  fetchPagesByWorkspace,
} from "../bootstrap";
import {
  __resetExternalProtectedDatabaseLoadForTests,
  ensureDatabaseRowsLoaded,
  ensureExternalProtectedDatabaseLoaded,
  loadMoreExternalProtectedDatabaseRows,
  protectedDatabaseRowsAreCached,
  resolveDatabaseRowRemoteKey,
  resolveExternalProtectedDatabaseId,
} from "../externalProtectedDatabaseLoad";

vi.mock("../bootstrap", () => ({
  fetchDatabaseById: vi.fn(),
  fetchDatabaseRowIndexBatch: vi.fn(),
  fetchDatabaseRowsBatch: vi.fn(),
  fetchDatabasesByWorkspace: vi.fn(),
  fetchPagesByWorkspace: vi.fn(),
}));

const fetchDatabaseByIdMock = vi.mocked(fetchDatabaseById);
const fetchDatabaseRowIndexBatchMock = vi.mocked(fetchDatabaseRowIndexBatch);
const fetchDatabaseRowsBatchMock = vi.mocked(fetchDatabaseRowsBatch);
const fetchDatabasesByWorkspaceMock = vi.mocked(fetchDatabasesByWorkspace);
const fetchPagesByWorkspaceMock = vi.mocked(fetchPagesByWorkspace);

beforeEach(() => {
  __resetExternalProtectedDatabaseLoadForTests();
  fetchDatabaseByIdMock.mockReset();
  fetchDatabaseRowIndexBatchMock.mockReset();
  fetchDatabaseRowsBatchMock.mockReset();
  fetchDatabasesByWorkspaceMock.mockReset();
  fetchPagesByWorkspaceMock.mockReset();
  useDatabaseStore.setState({ databases: {}, cacheWorkspaceId: null });
  usePageStore.setState({ pages: {}, activePageId: null, cacheWorkspaceId: null });
  useSchedulerViewStore.setState({ selectedProjectId: null, selectedMemberId: null });
});

describe("externalProtectedDatabaseLoad", () => {
  it("LC 스케줄러 DB id를 canonical id로 해석한다", () => {
    expect(resolveExternalProtectedDatabaseId(makeLCSchedulerDatabaseId("legacy-ws"))).toBe(
      LC_SCHEDULER_DATABASE_ID,
    );
    expect(resolveExternalProtectedDatabaseId("normal-db")).toBeNull();
  });

  it("DB 정의만 있으면 protected DB rows 캐시가 완성되지 않은 것으로 본다", () => {
    useDatabaseStore.setState({
      databases: {
        [LC_SCHEDULER_DATABASE_ID]: {
          meta: {
            id: LC_SCHEDULER_DATABASE_ID,
            workspaceId: LC_SCHEDULER_WORKSPACE_ID,
            title: "작업",
            createdAt: 1,
            updatedAt: 1,
          },
          columns: [],
          rowPageOrder: [],
        },
      },
    });

    expect(protectedDatabaseRowsAreCached(LC_SCHEDULER_DATABASE_ID)).toBe(false);
  });

  it("row remote key는 일반 DB와 scoped protected DB를 로더와 동일하게 계산한다", () => {
    expect(resolveDatabaseRowRemoteKey("normal-db", "cat-workspace")).toBe("normal-db");

    useSchedulerViewStore.setState({
      selectedProjectId: "proj:project-1",
      selectedMemberId: "member-1",
    });

    expect(resolveDatabaseRowRemoteKey(LC_SCHEDULER_DATABASE_ID, "cat-workspace")).toBe(
      `${LC_SCHEDULER_DATABASE_ID}|p:project-1|m:member-1`,
    );
  });

  it("row order의 page가 page store에 모두 있어야 캐시 완료로 본다", () => {
    useDatabaseStore.setState({
      databases: {
        [LC_SCHEDULER_DATABASE_ID]: {
          meta: {
            id: LC_SCHEDULER_DATABASE_ID,
            workspaceId: LC_SCHEDULER_WORKSPACE_ID,
            title: "작업",
            createdAt: 1,
            updatedAt: 1,
          },
          columns: [],
          rowPageOrder: ["row-1"],
        },
      },
    });

    expect(protectedDatabaseRowsAreCached(LC_SCHEDULER_DATABASE_ID)).toBe(false);

    usePageStore.setState({
      pages: {
        "row-1": {
          id: "row-1",
          workspaceId: LC_SCHEDULER_WORKSPACE_ID,
          title: "작업 1",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 1,
          createdAt: 1,
          updatedAt: 1,
          databaseId: LC_SCHEDULER_DATABASE_ID,
        },
      },
    });

    expect(protectedDatabaseRowsAreCached(LC_SCHEDULER_DATABASE_ID)).toBe(true);
  });

  it("메타만 적재된(contentLoaded=false) row 는 캐시 미완료로 본다", () => {
    useDatabaseStore.setState({
      databases: {
        [LC_SCHEDULER_DATABASE_ID]: {
          meta: {
            id: LC_SCHEDULER_DATABASE_ID,
            workspaceId: LC_SCHEDULER_WORKSPACE_ID,
            title: "작업",
            createdAt: 1,
            updatedAt: 1,
          },
          columns: [],
          rowPageOrder: ["row-1"],
        },
      },
    });
    usePageStore.setState({
      pages: {
        "row-1": {
          id: "row-1",
          workspaceId: LC_SCHEDULER_WORKSPACE_ID,
          title: "작업 1",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 1,
          createdAt: 1,
          updatedAt: 1,
          databaseId: LC_SCHEDULER_DATABASE_ID,
          contentLoaded: false,
        },
      },
    });

    expect(protectedDatabaseRowsAreCached(LC_SCHEDULER_DATABASE_ID)).toBe(false);
  });

  it("홈 워크스페이스(LC 스케줄러) 내부에서도 row 콘텐츠를 listDatabaseRows 로 적재한다", async () => {
    const updatedAt = "2026-06-04T00:00:00.000Z";
    fetchDatabaseByIdMock.mockResolvedValue({
      id: LC_SCHEDULER_DATABASE_ID,
      workspaceId: LC_SCHEDULER_WORKSPACE_ID,
      createdByMemberId: "member-1",
      title: "작업",
      columns: [],
      presets: [],
      panelState: null,
      createdAt: updatedAt,
      updatedAt,
    });
    fetchDatabaseRowsBatchMock.mockResolvedValueOnce({
      items: [
        {
          id: "row-1",
          workspaceId: LC_SCHEDULER_WORKSPACE_ID,
          createdByMemberId: "member-1",
          title: "작업 1",
          parentId: null,
          order: "1",
          databaseId: LC_SCHEDULER_DATABASE_ID,
          doc: { type: "doc", content: [] },
          dbCells: {},
          blockComments: null,
          createdAt: updatedAt,
          updatedAt,
        },
      ],
      nextToken: null,
    });

    await expect(
      ensureExternalProtectedDatabaseLoaded({
        databaseId: LC_SCHEDULER_DATABASE_ID,
        currentWorkspaceId: LC_SCHEDULER_WORKSPACE_ID,
        source: "test",
      }),
    ).resolves.toBe(true);

    expect(fetchDatabaseRowsBatchMock).toHaveBeenCalledWith({
      workspaceId: LC_SCHEDULER_WORKSPACE_ID,
      databaseId: LC_SCHEDULER_DATABASE_ID,
      limit: 100,
    });
    expect(usePageStore.getState().pages["row-1"]).toBeDefined();
  });

  it("일반 워크스페이스 DB도 row 콘텐츠를 listDatabaseRows 로 적재한다", async () => {
    const updatedAt = "2026-06-04T00:00:00.000Z";
    fetchDatabaseByIdMock.mockResolvedValue({
      id: "normal-db",
      workspaceId: "cat-workspace",
      createdByMemberId: "member-1",
      title: "CAT DB",
      columns: [],
      presets: [],
      panelState: null,
      createdAt: updatedAt,
      updatedAt,
    });
    fetchDatabaseRowsBatchMock.mockResolvedValueOnce({
      items: [
        {
          id: "cat-row-1",
          workspaceId: "cat-workspace",
          createdByMemberId: "member-1",
          title: "항목 1",
          parentId: null,
          order: "1",
          databaseId: "normal-db",
          doc: { type: "doc", content: [] },
          dbCells: {},
          blockComments: null,
          createdAt: updatedAt,
          updatedAt,
        },
      ],
      nextToken: null,
    });

    await expect(
      ensureDatabaseRowsLoaded({
        databaseId: "normal-db",
        currentWorkspaceId: "cat-workspace",
        source: "test",
      }),
    ).resolves.toBe(true);

    expect(fetchDatabaseByIdMock).toHaveBeenCalledWith("cat-workspace", "normal-db");
    expect(fetchDatabaseRowsBatchMock).toHaveBeenCalledWith({
      workspaceId: "cat-workspace",
      databaseId: "normal-db",
      limit: 100,
    });
    expect(useDatabaseStore.getState().databases["normal-db"]?.rowPageOrder).toEqual([
      "cat-row-1",
    ]);
    expect(usePageStore.getState().pages["cat-row-1"]).toBeDefined();
  });

  it("캐시가 없을 때만 보이는 protected DB에서 LC 스케줄러 스냅샷을 지연 로드한다", async () => {
    const updatedAt = "2026-06-04T00:00:00.000Z";
    fetchDatabaseByIdMock.mockResolvedValue({
      id: LC_SCHEDULER_DATABASE_ID,
      workspaceId: LC_SCHEDULER_WORKSPACE_ID,
      createdByMemberId: "member-1",
      title: "작업",
      columns: [],
      presets: [],
      panelState: null,
      createdAt: updatedAt,
      updatedAt,
    });
    fetchDatabaseRowsBatchMock.mockResolvedValueOnce({
      items: [
        {
          id: "row-1",
          workspaceId: LC_SCHEDULER_WORKSPACE_ID,
          createdByMemberId: "member-1",
          title: "작업 1",
          parentId: null,
          order: "1",
          databaseId: LC_SCHEDULER_DATABASE_ID,
          doc: { type: "doc", content: [] },
          dbCells: {},
          blockComments: null,
          createdAt: updatedAt,
          updatedAt,
        },
      ],
      nextToken: "next-1",
    });
    fetchDatabaseRowIndexBatchMock.mockResolvedValueOnce({
      items: [
        {
          id: "row-2",
          workspaceId: LC_SCHEDULER_WORKSPACE_ID,
          title: "작업 2",
          icon: null,
          order: "2",
          databaseId: LC_SCHEDULER_DATABASE_ID,
          dbCells: {},
          createdAt: updatedAt,
          updatedAt,
        },
      ],
      nextToken: null,
    });

    await expect(
      ensureExternalProtectedDatabaseLoaded({
        databaseId: makeLCSchedulerDatabaseId("legacy-ws"),
        currentWorkspaceId: "cat-workspace",
        source: "test",
      }),
    ).resolves.toBe(true);

    expect(fetchDatabaseByIdMock).toHaveBeenCalledWith(LC_SCHEDULER_WORKSPACE_ID, LC_SCHEDULER_DATABASE_ID);
    expect(fetchDatabaseRowsBatchMock).toHaveBeenCalledWith({
      workspaceId: LC_SCHEDULER_WORKSPACE_ID,
      databaseId: LC_SCHEDULER_DATABASE_ID,
      limit: 100,
    });
    expect(useDatabaseStore.getState().databases[LC_SCHEDULER_DATABASE_ID]?.rowPageOrder).toEqual([
      "row-1",
    ]);
    expect(usePageStore.getState().pages["row-1"]).toBeDefined();
    expect(useDatabaseRowRemoteStore.getState().nextTokenByDatabaseId[LC_SCHEDULER_DATABASE_ID]).toBeNull();

    fetchDatabaseByIdMock.mockClear();
    fetchDatabaseRowsBatchMock.mockClear();

    await expect(
      ensureExternalProtectedDatabaseLoaded({
        databaseId: LC_SCHEDULER_DATABASE_ID,
        currentWorkspaceId: "cat-workspace",
        source: "test",
      }),
    ).resolves.toBe(false);

    expect(fetchDatabaseByIdMock).not.toHaveBeenCalled();
    expect(fetchDatabaseRowsBatchMock).not.toHaveBeenCalled();
  });

  it("신규 row API가 아직 배포되지 않았으면 구형 full snapshot fallback을 사용한다", async () => {
    const updatedAt = "2026-06-04T00:00:00.000Z";
    fetchDatabaseByIdMock.mockRejectedValueOnce(
      new Error("Validation error: Cannot query field getDatabase"),
    );
    fetchDatabaseRowsBatchMock.mockResolvedValueOnce({ items: [], nextToken: null });
    fetchDatabasesByWorkspaceMock.mockResolvedValueOnce([
      {
        id: LC_SCHEDULER_DATABASE_ID,
        workspaceId: LC_SCHEDULER_WORKSPACE_ID,
        createdByMemberId: "member-1",
        title: "작업",
        columns: [],
        createdAt: updatedAt,
        updatedAt,
      },
    ]);
    fetchPagesByWorkspaceMock.mockResolvedValueOnce([
      {
        id: "row-legacy",
        workspaceId: LC_SCHEDULER_WORKSPACE_ID,
        createdByMemberId: "member-1",
        title: "작업",
        parentId: null,
        order: "1",
        databaseId: LC_SCHEDULER_DATABASE_ID,
        doc: { type: "doc", content: [] },
        dbCells: {},
        blockComments: null,
        createdAt: updatedAt,
        updatedAt,
      },
    ]);

    await expect(
      ensureExternalProtectedDatabaseLoaded({
        databaseId: LC_SCHEDULER_DATABASE_ID,
        currentWorkspaceId: "cat-workspace",
        source: "test",
      }),
    ).resolves.toBe(true);

    expect(fetchDatabasesByWorkspaceMock).toHaveBeenCalledWith(LC_SCHEDULER_WORKSPACE_ID);
    expect(fetchPagesByWorkspaceMock).toHaveBeenCalledWith(LC_SCHEDULER_WORKSPACE_ID);
    expect(useDatabaseStore.getState().databases[LC_SCHEDULER_DATABASE_ID]?.rowPageOrder).toEqual([
      "row-legacy",
    ]);
    expect(useDatabaseRowRemoteStore.getState().nextTokenByDatabaseId[LC_SCHEDULER_DATABASE_ID]).toBeNull();
  });

  it("nextToken이 있으면 다음 row batch만 추가로 로드한다", async () => {
    const updatedAt = "2026-06-04T00:00:00.000Z";
    useDatabaseRowRemoteStore.getState().setNextToken(LC_SCHEDULER_DATABASE_ID, "next-1");
    fetchDatabaseRowsBatchMock.mockResolvedValueOnce({
      items: [
        {
          id: "row-2",
          workspaceId: LC_SCHEDULER_WORKSPACE_ID,
          createdByMemberId: "member-1",
          title: "작업 2",
          parentId: null,
          order: "2",
          databaseId: LC_SCHEDULER_DATABASE_ID,
          doc: { type: "doc", content: [] },
          dbCells: {},
          blockComments: null,
          createdAt: updatedAt,
          updatedAt,
        },
      ],
      nextToken: null,
    });

    await expect(
      loadMoreExternalProtectedDatabaseRows({
        databaseId: LC_SCHEDULER_DATABASE_ID,
        currentWorkspaceId: "cat-workspace",
        rowLimit: 10,
        source: "test",
      }),
    ).resolves.toBe(true);

    expect(fetchDatabaseRowsBatchMock).toHaveBeenCalledWith({
      workspaceId: LC_SCHEDULER_WORKSPACE_ID,
      databaseId: LC_SCHEDULER_DATABASE_ID,
      limit: 10,
      nextToken: "next-1",
    });
    expect(usePageStore.getState().pages["row-2"]).toBeDefined();
    expect(useDatabaseRowRemoteStore.getState().nextTokenByDatabaseId[LC_SCHEDULER_DATABASE_ID]).toBeNull();
  });

  it("로컬 row 캐시가 있어도 pagination 상태가 없으면 nextToken 확인을 위해 첫 batch를 조회한다", async () => {
    const updatedAt = "2026-06-04T00:00:00.000Z";
    useDatabaseStore.setState({
      databases: {
        "normal-db": {
          meta: {
            id: "normal-db",
            workspaceId: "cat-workspace",
            title: "CAT DB",
            createdAt: 1,
            updatedAt: 1,
          },
          columns: [],
          rowPageOrder: ["row-1"],
        },
      },
      cacheWorkspaceId: "cat-workspace",
    });
    usePageStore.setState({
      pages: {
        "row-1": {
          id: "row-1",
          workspaceId: "cat-workspace",
          title: "작업 1",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 1,
          createdAt: 1,
          updatedAt: 1,
          databaseId: "normal-db",
          contentLoaded: true,
        },
      },
      cacheWorkspaceId: "cat-workspace",
    });
    fetchDatabaseByIdMock.mockResolvedValueOnce({
      id: "normal-db",
      workspaceId: "cat-workspace",
      createdByMemberId: "member-1",
      title: "CAT DB",
      columns: [],
      createdAt: updatedAt,
      updatedAt,
    });
    fetchDatabaseRowsBatchMock.mockResolvedValueOnce({
      items: [
        {
          id: "row-1",
          workspaceId: "cat-workspace",
          createdByMemberId: "member-1",
          title: "작업 1",
          parentId: null,
          order: "1",
          databaseId: "normal-db",
          doc: { type: "doc", content: [] },
          dbCells: {},
          blockComments: null,
          createdAt: updatedAt,
          updatedAt,
        },
      ],
      nextToken: "next-1",
    });
    fetchDatabaseRowIndexBatchMock.mockResolvedValueOnce({
      items: [
        {
          id: "row-2",
          workspaceId: "cat-workspace",
          title: "작업 2",
          icon: null,
          order: "2",
          databaseId: "normal-db",
          dbCells: {},
          createdAt: updatedAt,
          updatedAt,
        },
      ],
      nextToken: null,
    });

    await expect(
      ensureDatabaseRowsLoaded({
        databaseId: "normal-db",
        currentWorkspaceId: "cat-workspace",
        source: "test",
      }),
    ).resolves.toBe(true);

    expect(fetchDatabaseRowsBatchMock).toHaveBeenCalledWith({
      workspaceId: "cat-workspace",
      databaseId: "normal-db",
      limit: 100,
    });
    expect(useDatabaseRowRemoteStore.getState().nextTokenByDatabaseId["normal-db"]).toBeNull();
  });

  it("부분 row 캐시가 더 큰 rowLimit 요청을 막지 않는다", async () => {
    const updatedAt = "2026-06-04T00:00:00.000Z";
    const cachedRowIds = Array.from({ length: 10 }, (_, index) => `row-${index + 1}`);
    useDatabaseStore.setState({
      databases: {
        "normal-db": {
          meta: {
            id: "normal-db",
            workspaceId: "cat-workspace",
            title: "CAT DB",
            createdAt: 1,
            updatedAt: 1,
          },
          columns: [],
          rowPageOrder: cachedRowIds,
        },
      },
      cacheWorkspaceId: "cat-workspace",
    });
    usePageStore.setState({
      pages: Object.fromEntries(
        cachedRowIds.map((id, index) => [
          id,
          {
            id,
            workspaceId: "cat-workspace",
            title: id,
            icon: null,
            doc: { type: "doc", content: [] },
            parentId: null,
            order: index + 1,
            createdAt: 1,
            updatedAt: 1,
            databaseId: "normal-db",
            contentLoaded: true,
          },
        ]),
      ),
      cacheWorkspaceId: "cat-workspace",
    });
    useDatabaseRowRemoteStore.getState().setNextToken("normal-db", "next-1");
    fetchDatabaseByIdMock.mockResolvedValueOnce({
      id: "normal-db",
      workspaceId: "cat-workspace",
      createdByMemberId: "member-1",
      title: "CAT DB",
      columns: [],
      createdAt: updatedAt,
      updatedAt,
    });
    fetchDatabaseRowsBatchMock.mockResolvedValueOnce({
      items: [
        {
          id: "row-11",
          workspaceId: "cat-workspace",
          createdByMemberId: "member-1",
          title: "row 11",
          parentId: null,
          order: "11",
          databaseId: "normal-db",
          doc: { type: "doc", content: [] },
          dbCells: {},
          blockComments: null,
          createdAt: updatedAt,
          updatedAt,
        },
      ],
      nextToken: "next-2",
    });
    fetchDatabaseRowIndexBatchMock.mockResolvedValueOnce({
      items: [
        {
          id: "row-12",
          workspaceId: "cat-workspace",
          createdByMemberId: "member-1",
          title: "row 12",
          parentId: null,
          order: "12",
          databaseId: "normal-db",
          doc: { type: "doc", content: [] },
          dbCells: {},
          blockComments: null,
          createdAt: updatedAt,
          updatedAt,
        },
      ],
      nextToken: null,
    });

    await expect(
      ensureDatabaseRowsLoaded({
        databaseId: "normal-db",
        currentWorkspaceId: "cat-workspace",
        rowLimit: 100,
        source: "test-fullpage",
      }),
    ).resolves.toBe(true);

    expect(fetchDatabaseRowsBatchMock).toHaveBeenCalledWith({
      workspaceId: "cat-workspace",
      databaseId: "normal-db",
      limit: 100,
    });
    expect(useDatabaseStore.getState().databases["normal-db"]?.rowPageOrder).toContain("row-11");
    expect(useDatabaseRowRemoteStore.getState().nextTokenByDatabaseId["normal-db"]).toBeNull();
  });

});
