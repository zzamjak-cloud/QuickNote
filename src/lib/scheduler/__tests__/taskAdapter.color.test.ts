import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDatabaseStore } from "../../../store/databaseStore";
import { usePageStore } from "../../../store/pageStore";
import type { CellValue } from "../../../types/database";
import type { Page } from "../../../types/page";
import {
  LC_SCHEDULER_COLUMN_IDS,
  ensureLCSchedulerDatabase,
  makeLCSchedulerDatabaseId,
} from "../database";
import { LC_SCHEDULER_WORKSPACE_ID } from "../scope";
import {
  makeScheduleInstanceId,
  projectLCSchedulerPageSchedules,
  updateLCSchedulerSchedule,
} from "../taskAdapter";

vi.mock("../../sync/runtime", () => ({
  enqueueAsync: vi.fn(),
}));

function makeRowPage(id: string, databaseId: string, dbCells: Record<string, CellValue>): Page {
  return {
    id,
    workspaceId: LC_SCHEDULER_WORKSPACE_ID,
    title: "공통 작업",
    icon: null,
    doc: { type: "doc", content: [] },
    parentId: null,
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    databaseId,
    dbCells,
  };
}

describe("LC scheduler task adapter colors", () => {
  beforeEach(() => {
    useDatabaseStore.setState({
      databases: {},
      cacheWorkspaceId: null,
      migrationQuarantine: [],
      dbTemplates: {},
    });
    usePageStore.setState({ pages: {}, activePageId: null, cacheWorkspaceId: null });
  });

  it("assignee 카드 컬러 변경은 같은 row의 다른 assignee 카드 컬러를 바꾸지 않는다", async () => {
    const workspaceId = LC_SCHEDULER_WORKSPACE_ID;
    const databaseId = makeLCSchedulerDatabaseId(workspaceId);
    await ensureLCSchedulerDatabase(workspaceId);
    usePageStore.setState({
      pages: {
        "row-1": makeRowPage("row-1", databaseId, {
          [LC_SCHEDULER_COLUMN_IDS.period]: {
            start: "2026-06-01T00:00:00.000Z",
            end: "2026-06-02T23:59:59.999Z",
          },
          [LC_SCHEDULER_COLUMN_IDS.assignees]: ["member-a", "member-b"],
          [LC_SCHEDULER_COLUMN_IDS.color]: "#3498db",
        }),
      },
      activePageId: null,
      cacheWorkspaceId: workspaceId,
    });

    await updateLCSchedulerSchedule({
      id: makeScheduleInstanceId("row-1", "member-a"),
      workspaceId,
      color: "#f97316",
      textColor: "#ffffff",
    });

    const projected = projectLCSchedulerPageSchedules(workspaceId, "row-1", [
      { memberId: "member-a", name: "A" },
      { memberId: "member-b", name: "B" },
    ]);

    expect(projected.find((schedule) => schedule.assigneeId === "member-a")?.color).toBe("#f97316");
    expect(projected.find((schedule) => schedule.assigneeId === "member-b")?.color).toBe("#3498db");
  });

  it("카드 컬러 변경은 assignee가 하나뿐인 row의 공통 컬러 컬럼을 바꾸지 않는다", async () => {
    const workspaceId = LC_SCHEDULER_WORKSPACE_ID;
    const databaseId = makeLCSchedulerDatabaseId(workspaceId);
    await ensureLCSchedulerDatabase(workspaceId);
    usePageStore.setState({
      pages: {
        "row-1": makeRowPage("row-1", databaseId, {
          [LC_SCHEDULER_COLUMN_IDS.period]: {
            start: "2026-06-01T00:00:00.000Z",
            end: "2026-06-02T23:59:59.999Z",
          },
          [LC_SCHEDULER_COLUMN_IDS.assignees]: ["member-a"],
          [LC_SCHEDULER_COLUMN_IDS.color]: "#3498DB",
        }),
      },
      activePageId: null,
      cacheWorkspaceId: workspaceId,
    });

    await updateLCSchedulerSchedule({
      id: makeScheduleInstanceId("row-1", "member-a"),
      workspaceId,
      color: "#f97316",
      textColor: "#ffffff",
      colorScope: "card",
    });

    const page = usePageStore.getState().pages["row-1"];
    const projected = projectLCSchedulerPageSchedules(workspaceId, "row-1", [
      { memberId: "member-a", name: "A" },
    ]);

    expect(page?.dbCells?.[LC_SCHEDULER_COLUMN_IDS.color]).toBe("#3498DB");
    expect(projected.find((schedule) => schedule.assigneeId === "member-a")?.color).toBe("#f97316");
  });
});
