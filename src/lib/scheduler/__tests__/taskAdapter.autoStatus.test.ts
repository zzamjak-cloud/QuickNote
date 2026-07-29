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
import { computeScheduleAutoStatus } from "../autoStatus";
import {
  makeScheduleInstanceId,
  sweepLCSchedulerPastStatuses,
  updateLCSchedulerSchedule,
} from "../taskAdapter";

vi.mock("../../sync/runtime", () => ({
  enqueueAsync: vi.fn(),
}));

const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();

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

function statusOf(pageId: string): CellValue {
  return usePageStore.getState().pages[pageId]?.dbCells?.[LC_SCHEDULER_COLUMN_IDS.status] ?? null;
}

describe("computeScheduleAutoStatus", () => {
  it("종료일이 지났으면 done", () => {
    expect(computeScheduleAutoStatus(iso(-3), iso(-1))).toBe("done");
  });
  it("시작일이 미래면 todo", () => {
    expect(computeScheduleAutoStatus(iso(1), iso(3))).toBe("todo");
  });
  it("오늘이 기간 내면 progress", () => {
    expect(computeScheduleAutoStatus(iso(-1), iso(1))).toBe("progress");
  });
});

describe("LC scheduler 상태 자동화", () => {
  const workspaceId = LC_SCHEDULER_WORKSPACE_ID;
  const databaseId = makeLCSchedulerDatabaseId(workspaceId);

  beforeEach(() => {
    useDatabaseStore.setState({
      databases: {},
      cacheWorkspaceId: null,
      migrationQuarantine: [],
      dbTemplates: {},
    });
    usePageStore.setState({ pages: {}, activePageId: null, cacheWorkspaceId: null });
  });

  async function seedRow(id: string, dbCells: Record<string, CellValue>): Promise<void> {
    await ensureLCSchedulerDatabase(workspaceId);
    usePageStore.setState({
      pages: {
        ...usePageStore.getState().pages,
        [id]: makeRowPage(id, databaseId, dbCells),
      },
      activePageId: null,
      cacheWorkspaceId: workspaceId,
    });
  }

  it("카드를 과거 기간으로 이동하면 상태가 done 이 된다", async () => {
    await seedRow("row-1", {
      [LC_SCHEDULER_COLUMN_IDS.period]: { start: iso(1), end: iso(2) },
      [LC_SCHEDULER_COLUMN_IDS.status]: "todo",
      [LC_SCHEDULER_COLUMN_IDS.assignees]: ["member-a"],
    });
    await updateLCSchedulerSchedule({
      id: makeScheduleInstanceId("row-1", "member-a"),
      workspaceId,
      startAt: iso(-3),
      endAt: iso(-1),
    });
    expect(statusOf("row-1")).toBe("done");
  });

  it("카드를 미래 기간으로 이동하면 상태가 todo 가 된다", async () => {
    await seedRow("row-1", {
      [LC_SCHEDULER_COLUMN_IDS.period]: { start: iso(-3), end: iso(-1) },
      [LC_SCHEDULER_COLUMN_IDS.status]: "done",
      [LC_SCHEDULER_COLUMN_IDS.assignees]: ["member-a"],
    });
    await updateLCSchedulerSchedule({
      id: makeScheduleInstanceId("row-1", "member-a"),
      workspaceId,
      startAt: iso(1),
      endAt: iso(3),
    });
    expect(statusOf("row-1")).toBe("todo");
  });

  it("오늘이 포함된 기간으로 이동하면 상태가 progress 가 된다", async () => {
    await seedRow("row-1", {
      [LC_SCHEDULER_COLUMN_IDS.period]: { start: iso(1), end: iso(2) },
      [LC_SCHEDULER_COLUMN_IDS.status]: "todo",
      [LC_SCHEDULER_COLUMN_IDS.assignees]: ["member-a"],
    });
    await updateLCSchedulerSchedule({
      id: makeScheduleInstanceId("row-1", "member-a"),
      workspaceId,
      startAt: iso(-1),
      endAt: iso(1),
    });
    expect(statusOf("row-1")).toBe("progress");
  });

  it("보류(hold) 상태는 날짜를 이동해도 자동 변경되지 않는다", async () => {
    await seedRow("row-1", {
      [LC_SCHEDULER_COLUMN_IDS.period]: { start: iso(1), end: iso(2) },
      [LC_SCHEDULER_COLUMN_IDS.status]: "hold",
      [LC_SCHEDULER_COLUMN_IDS.assignees]: ["member-a"],
    });
    await updateLCSchedulerSchedule({
      id: makeScheduleInstanceId("row-1", "member-a"),
      workspaceId,
      startAt: iso(-3),
      endAt: iso(-1),
    });
    expect(statusOf("row-1")).toBe("hold");
  });

  it("근태(연차) 행은 날짜를 이동해도 상태를 건드리지 않는다", async () => {
    await seedRow("row-1", {
      [LC_SCHEDULER_COLUMN_IDS.period]: { start: iso(1), end: iso(2) },
      [LC_SCHEDULER_COLUMN_IDS.status]: "todo",
      [LC_SCHEDULER_COLUMN_IDS.attendance]: "annual-leave",
      [LC_SCHEDULER_COLUMN_IDS.assignees]: ["member-a"],
    });
    await updateLCSchedulerSchedule({
      id: makeScheduleInstanceId("row-1", "member-a"),
      workspaceId,
      startAt: iso(-3),
      endAt: iso(-1),
    });
    expect(statusOf("row-1")).toBe("todo");
  });

  it("레거시 leave 센티널 상태는 덮어쓰지 않는다", async () => {
    await seedRow("row-1", {
      [LC_SCHEDULER_COLUMN_IDS.period]: { start: iso(1), end: iso(2) },
      [LC_SCHEDULER_COLUMN_IDS.status]: "leave",
      [LC_SCHEDULER_COLUMN_IDS.assignees]: ["member-a"],
    });
    await updateLCSchedulerSchedule({
      id: makeScheduleInstanceId("row-1", "member-a"),
      workspaceId,
      startAt: iso(-3),
      endAt: iso(-1),
    });
    expect(statusOf("row-1")).toBe("leave");
  });

  it("스윕은 지난 카드만 done 처리하고 보류·근태·미래 카드는 건너뛴다", async () => {
    await seedRow("past-todo", {
      [LC_SCHEDULER_COLUMN_IDS.period]: { start: iso(-5), end: iso(-2) },
      [LC_SCHEDULER_COLUMN_IDS.status]: "todo",
    });
    await seedRow("past-hold", {
      [LC_SCHEDULER_COLUMN_IDS.period]: { start: iso(-5), end: iso(-2) },
      [LC_SCHEDULER_COLUMN_IDS.status]: "hold",
    });
    await seedRow("past-leave", {
      [LC_SCHEDULER_COLUMN_IDS.period]: { start: iso(-5), end: iso(-2) },
      [LC_SCHEDULER_COLUMN_IDS.status]: "todo",
      [LC_SCHEDULER_COLUMN_IDS.attendance]: "annual-leave",
    });
    await seedRow("future-todo", {
      [LC_SCHEDULER_COLUMN_IDS.period]: { start: iso(1), end: iso(3) },
      [LC_SCHEDULER_COLUMN_IDS.status]: "todo",
    });
    await seedRow("ongoing-progress", {
      [LC_SCHEDULER_COLUMN_IDS.period]: { start: iso(-1), end: iso(1) },
      [LC_SCHEDULER_COLUMN_IDS.status]: "progress",
    });

    const updated = sweepLCSchedulerPastStatuses(workspaceId);

    expect(updated).toBe(1);
    expect(statusOf("past-todo")).toBe("done");
    expect(statusOf("past-hold")).toBe("hold");
    expect(statusOf("past-leave")).toBe("todo");
    expect(statusOf("future-todo")).toBe("todo");
    expect(statusOf("ongoing-progress")).toBe("progress");
  });
});
