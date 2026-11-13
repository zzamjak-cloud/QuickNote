import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LC_SCHEDULER_COLUMN_IDS as COL, LC_SCHEDULER_DATABASE_ID } from "../../../../src/lib/scheduler/schedulerSchema";
import { runTool } from "../toolRunner";
import { createPagesTool } from "../tools/createPages";
import { updateDatabaseTool } from "../tools/updateDatabase";
import { updatePageTool } from "../tools/updatePage";
import { listMmEntriesTool, reviewMmEntryTool, setMmEntryLockTool, upsertMmEntryTool } from "../tools/scheduler/mmEntries";
import {
  createHolidayTool,
  createSchedulerProjectTool,
  deleteHolidayTool,
  deleteSchedulerProjectTool,
  listHolidaysTool,
  listSchedulerProjectsTool,
  updateSchedulerProjectTool,
} from "../tools/scheduler/projectsHolidays";
import { createScheduleTool, deleteScheduleTool, listSchedulesTool, updateScheduleTool } from "../tools/scheduler/schedules";
import { publishMock, resetCollabMocks } from "./collabMocks";
import { readDbRoom, seedDbRoom, WRITE } from "./dbFixtures";
import type { Item } from "./fakeDdb";
import { baseTables, makeCtx, member } from "./fixtures";

vi.mock("../../realtime/yjsStore", async () => (await import("./collabMocks")).yjsStoreMock);
vi.mock("../wsBroadcast", async () => (await import("./collabMocks")).broadcastMock);
vi.mock("../publish", async () => (await import("./collabMocks")).publishMock);

const WS = "lc-scheduler-global";
const DB = LC_SCHEDULER_DATABASE_ID;
const MILESTONE_DB = `lc-milestone-db:${WS}`;
const TS = "2026-01-01T00:00:00.000Z";

function schedulerTables(opts: { presets?: unknown[] } = {}): Record<string, Item[]> {
  const tables = baseTables();
  tables.members.push(member({ memberId: "m3", name: "Carol", email: "carol@example.com" }) as unknown as Item);
  tables.databases = [
    { id: DB, workspaceId: WS, title: "작업", columns: "[]", presets: JSON.stringify(opts.presets ?? []), createdAt: TS, updatedAt: TS },
    {
      id: MILESTONE_DB, workspaceId: WS, title: "마일스톤", createdAt: TS, updatedAt: TS,
      columns: JSON.stringify([
        { id: "lc-milestone:title", name: "마일스톤", type: "title" },
        { id: "lc-milestone:goal", name: "목표", type: "text" },
        { id: "lc-milestone:project", name: "프로젝트", type: "select", config: { linkedScope: "project" } },
      ]),
    },
  ];
  tables.projects = [{ id: "p1", workspaceId: WS, name: "Alpha", color: "#111111", memberIds: [], leaderMemberIds: [], isHidden: false, createdAt: TS, updatedAt: TS }];
  return tables;
}

function setup(opts: { token?: object; presets?: unknown[]; caller?: object } = {}) {
  const made = makeCtx(schedulerTables(opts), (opts.token ?? WRITE) as never);
  if (opts.caller) made.ctx.caller = member(opts.caller);
  return made;
}

type Fake = ReturnType<typeof setup>["fake"];
const pageOf = (fake: Fake, id: string) => fake.tables.pages.find((p) => p.id === id) as Item;
const cellsOf = (fake: Fake, id: string) => JSON.parse(String(pageOf(fake, id).dbCells)) as Record<string, unknown>;

function scheduleRow(id: string, cells: Record<string, unknown>, extra: Item = {}): Item {
  return { id, workspaceId: WS, databaseId: DB, title: "작업", order: "1", parentId: null, createdAt: TS, updatedAt: TS, dbCells: JSON.stringify(cells), ...extra };
}

beforeEach(() => {
  resetCollabMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  // KST 2026-03-10 12:00
  vi.setSystemTime(new Date("2026-03-10T03:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

describe("create_schedule", () => {
  it("일정 프리셋·KST 기간·meta·auto-status(진행중) + 색인·DB 룸·발행", async () => {
    const { ctx, fake } = setup();
    seedDbRoom(DB, { columns: [], rows: {}, order: [] });
    const r = await createScheduleTool(ctx, { title: "기획", startDate: "2026-03-09", endDate: "2026-03-11", assignee: "bob@example.com" });
    const card = r.created[0];
    expect(card).toMatchObject({ id: `${card.pageId}::m2`, title: "기획", status: "progress", kind: "schedule", assigneeId: "m2", assigneeName: "Bob", startDate: "2026-03-09", endDate: "2026-03-11" });
    const cells = cellsOf(fake, card.pageId);
    expect(cells[COL.period]).toEqual({ start: "2026-03-08T15:00:00.000Z", end: "2026-03-11T14:59:59.999Z" });
    expect(cells[COL.assignees]).toEqual(["m2"]);
    expect(cells[COL.status]).toBe("progress");
    // 담당자 있고 색 미지정 → 앱처럼 행 색 셀 비움(표시는 기본 파랑)
    expect(cells[COL.color]).toBeUndefined();
    expect(cells[COL.meta]).toEqual({ kind: "schedule", textColor: null, rowIndexByAssigneeId: { m2: 0 } });
    expect(pageOf(fake, card.pageId)).toMatchObject({ title: "기획", databaseId: DB, workspaceId: WS, lastEditSource: "mcp" });
    expect(fake.tables.schedules.map((s) => s.id)).toEqual([`${card.pageId}::m2`]);
    expect(r.cellsWrittenTo).toBe("collab");
    const room = readDbRoom(DB) as { rows: Record<string, Record<string, unknown>>; rowPageOrder: string[] };
    expect(room.rows[card.pageId][COL.status]).toBe("progress");
    expect(room.rowPageOrder).toContain(card.pageId);
    expect(publishMock.publishPage).toHaveBeenCalledWith(expect.objectContaining({ id: card.pageId }));
  });

  it("미래는 todo, 과거는 done, 명시 status 우선", async () => {
    const { ctx } = setup();
    const future = await createScheduleTool(ctx, { title: "a", startDate: "2026-04-01", assignee: "m1" });
    const past = await createScheduleTool(ctx, { title: "b", startDate: "2026-03-01", assignee: "m1" });
    const held = await createScheduleTool(ctx, { title: "c", startDate: "2026-03-01", assignee: "m1", status: "hold" });
    expect([future.created[0].status, past.created[0].status, held.created[0].status]).toEqual(["todo", "done", "hold"]);
  });

  it("담당자 없는 특수 일정은 주황색·대비 글자색, 저장된 프리셋 기본값을 쓴다", async () => {
    const presets = [{ id: "lc-scheduler-preset:task", columnDefaults: { [COL.title]: "일정", [COL.status]: "todo", [COL.color]: "#2ECC71", [COL.meta]: { kind: "schedule" } } }];
    const { ctx, fake } = setup({ presets });
    const r = await createScheduleTool(ctx, { startDate: "2026-03-20", projectId: "p1" });
    const card = r.created[0];
    expect(card).toMatchObject({ id: `${card.pageId}::__global__`, title: "일정", color: "#f59e0b", projectId: "p1", status: "todo" });
    const cells = cellsOf(fake, card.pageId);
    expect(cells[COL.assignees]).toEqual([]);
    expect(cells[COL.project]).toBe("p1");
    expect((cells[COL.meta] as Item).textColor).toBe("#1a1a1a");
  });

  it("근태(연차) 프리셋: 제목·근태 셀·meta kind leave, 지난 날짜여도 상태 자동 변경 없음", async () => {
    const { ctx, fake } = setup();
    const r = await createScheduleTool(ctx, { title: "근태", startDate: "2026-03-02", assignee: "m1" });
    const card = r.created[0];
    expect(card).toMatchObject({ title: "연차", kind: "leave", attendance: "annual-leave", status: "todo" });
    expect(cellsOf(fake, card.pageId)[COL.meta]).toMatchObject({ kind: "leave", annualLeave: true, attendanceValue: "annual-leave" });
    const half = await createScheduleTool(ctx, { startDate: "2026-03-12", assignee: "m1", attendance: "morning-half-day" });
    expect(half.created[0]).toMatchObject({ title: "오전반차", attendance: "morning-half-day" });
    expect(cellsOf(fake, half.created[0].pageId)[COL.meta]).toMatchObject({ kind: "leave", annualLeave: false, attendanceValue: "morning-half-day" });
  });

  it("검증: 없는 날짜·역순 기간·없는 프로젝트·없는 멤버", async () => {
    const { ctx } = setup();
    await expect(createScheduleTool(ctx, { startDate: "2026-02-30" })).rejects.toThrow(/valid YYYY-MM-DD/);
    await expect(createScheduleTool(ctx, { startDate: "2026-03-05", endDate: "2026-03-01" })).rejects.toThrow(/on or after/);
    await expect(createScheduleTool(ctx, { startDate: "2026-03-05", projectId: "nope" })).rejects.toThrow(/Unknown scheduler project/);
    await expect(createScheduleTool(ctx, { startDate: "2026-03-05", assignee: "ghost@example.com" })).rejects.toThrow(/Unknown or inactive member/);
  });
});

describe("update_schedule", () => {
  it("담당자 인스턴스 교체: 이 카드의 담당자만 바뀐다", async () => {
    const { ctx, fake } = setup();
    fake.tables.pages.push(scheduleRow("row1", { [COL.assignees]: ["m1", "m2"], [COL.period]: { start: "2026-03-08T15:00:00.000Z", end: "2026-03-09T14:59:59.999Z" }, [COL.status]: "done" }));
    const r = await updateScheduleTool(ctx, { id: "row1::m1", assignee: "carol@example.com" });
    expect(cellsOf(fake, "row1")[COL.assignees]).toEqual(["m2", "m3"]);
    expect(r.updated).toMatchObject({ id: "row1::m3", assigneeName: "Carol" });
    expect(r.cards.map((c) => c.id)).toEqual(["row1::m2", "row1::m3"]);
    expect(cellsOf(fake, "row1")[COL.status]).toBe("done"); // 기간 변경 없으면 상태 유지
    expect(fake.tables.schedules.map((s) => s.id).sort()).toEqual(["row1::m2", "row1::m3"]);
  });

  it("기간 변경 시 auto-status, 보류·근태는 유지", async () => {
    const { ctx, fake } = setup();
    const period = { start: "2026-02-01T15:00:00.000Z", end: "2026-02-02T14:59:59.999Z" };
    fake.tables.pages.push(
      scheduleRow("task", { [COL.assignees]: ["m1"], [COL.period]: period, [COL.status]: "done" }),
      scheduleRow("held", { [COL.assignees]: ["m1"], [COL.period]: period, [COL.status]: "hold" }),
      scheduleRow("leave", { [COL.assignees]: ["m1"], [COL.period]: period, [COL.status]: "todo", [COL.attendance]: "annual-leave", [COL.meta]: { kind: "leave" } }),
    );
    await updateScheduleTool(ctx, { id: "task::m1", startDate: "2026-03-09", endDate: "2026-03-12" });
    await updateScheduleTool(ctx, { id: "held::m1", startDate: "2026-03-09", endDate: "2026-03-12" });
    await updateScheduleTool(ctx, { id: "leave::m1", startDate: "2026-03-01", endDate: "2026-03-02" });
    await expect(updateScheduleTool(ctx, { id: "task::m1", startDate: "2026-03-20" })).rejects.toThrow(/on or after/);
    expect(cellsOf(fake, "task")[COL.status]).toBe("progress");
    expect(cellsOf(fake, "task")[COL.period]).toEqual({ start: "2026-03-08T15:00:00.000Z", end: "2026-03-12T14:59:59.999Z" });
    expect(cellsOf(fake, "held")[COL.status]).toBe("hold");
    expect(cellsOf(fake, "leave")[COL.status]).toBe("todo");
  });

  it("다중 담당자 행의 색은 카드 색(meta), colorScope row 는 행 색", async () => {
    const { ctx, fake } = setup();
    fake.tables.pages.push(scheduleRow("row1", { [COL.assignees]: ["m1", "m2"], [COL.period]: { start: "2026-03-08T15:00:00.000Z", end: "2026-03-09T14:59:59.999Z" } }));
    const r = await updateScheduleTool(ctx, { id: "row1::m2", color: "#E74C3C" });
    expect(cellsOf(fake, "row1")[COL.color]).toBeUndefined();
    expect(cellsOf(fake, "row1")[COL.meta]).toMatchObject({ colorByAssigneeId: { m2: "#E74C3C" }, textColorByAssigneeId: { m2: "#ffffff" } });
    expect(r.updated?.color).toBe("#E74C3C");
    await updateScheduleTool(ctx, { id: "row1::m2", color: "#2ECC71", colorScope: "row" });
    expect(cellsOf(fake, "row1")[COL.color]).toBe("#2ECC71");
  });

  it("DB 룸 셀이 권위: 룸 값을 기준으로 patch 하고 룸에도 기록", async () => {
    const { ctx, fake } = setup();
    fake.tables.pages.push(scheduleRow("row1", { [COL.assignees]: ["m1"], [COL.status]: "todo" }));
    seedDbRoom(DB, { columns: [], rows: { row1: { [COL.assignees]: ["m1"], [COL.status]: "hold" } }, order: ["row1"] });
    await updateScheduleTool(ctx, { id: "row1::m1", startDate: "2026-03-09" });
    const room = readDbRoom(DB) as { rows: Record<string, Record<string, unknown>> };
    expect(room.rows.row1[COL.status]).toBe("hold"); // 룸의 보류는 auto-status 대상 아님
    expect(room.rows.row1[COL.period]).toEqual({ start: "2026-03-08T15:00:00.000Z", end: "2026-03-09T14:59:59.999Z" });
  });

  it("다른 DB 행·휴지통 행·사라진 담당자 카드 id 는 거부", async () => {
    const { ctx, fake } = setup();
    fake.tables.pages.push(
      scheduleRow("gone", { [COL.assignees]: ["m1"] }, { deletedAt: TS }),
      scheduleRow("row1", { [COL.assignees]: ["m2"] }),
      { id: "other", workspaceId: "ws-a", databaseId: "db1", title: "x", order: "0", updatedAt: TS },
    );
    await expect(updateScheduleTool(ctx, { id: "other::m1", title: "x" })).rejects.toThrow(/Schedule not found/);
    await expect(updateScheduleTool(ctx, { id: "gone::m1", title: "x" })).rejects.toThrow(/trash/);
    await expect(updateScheduleTool(ctx, { id: "row1::m1", title: "x" })).rejects.toThrow(/no longer on the schedule/);
  });
});

describe("delete_schedule", () => {
  it("행 soft delete + 색인 제거 + DB 룸 행 제거 + tombstone 발행", async () => {
    const { ctx, fake } = setup();
    fake.tables.pages.push(scheduleRow("row1", { [COL.assignees]: ["m1"], [COL.period]: { start: "2026-03-08T15:00:00.000Z", end: "2026-03-09T14:59:59.999Z" } }));
    fake.tables.schedules = [{ id: "row1::m1", sourcePageId: "row1", workspaceId: WS, startAt: "2026-03-08T15:00:00.000Z", endAt: "2026-03-09T14:59:59.999Z" }];
    seedDbRoom(DB, { columns: [], rows: { row1: { [COL.assignees]: ["m1"] } }, order: ["row1"] });
    const r = await deleteScheduleTool(ctx, { id: "row1::m1" });
    expect(r).toMatchObject({ trashed: "row1", rowRemovedFrom: "collab", restorable: true });
    expect(pageOf(fake, "row1").deletedAt).toBeTruthy();
    expect(fake.tables.schedules).toHaveLength(0);
    const room = readDbRoom(DB) as { rows: Record<string, unknown>; rowPageOrder: string[] };
    expect(room.rows.row1).toBeUndefined();
    expect(room.rowPageOrder).not.toContain("row1");
    expect(publishMock.publishPage).toHaveBeenCalledWith(expect.objectContaining({ id: "row1" }), expect.objectContaining({ deletedAt: expect.any(String) }));
  });
});

describe("list_schedules", () => {
  it("범위와 겹치는 카드(앞서 시작한 긴 일정 포함)·담당자 필터·휴지통 제외", async () => {
    const { ctx, fake } = setup();
    const long = scheduleRow("long", { [COL.assignees]: ["m1", "m2"], [COL.period]: { start: "2026-01-01T15:00:00.000Z", end: "2026-04-01T14:59:59.999Z" }, [COL.status]: "progress" });
    const later = scheduleRow("later", { [COL.assignees]: ["m1"], [COL.period]: { start: "2026-05-01T15:00:00.000Z", end: "2026-05-02T14:59:59.999Z" } });
    const trashed = scheduleRow("trashed", { [COL.assignees]: ["m1"], [COL.period]: { start: "2026-03-09T15:00:00.000Z", end: "2026-03-09T15:00:00.000Z" } }, { deletedAt: TS });
    fake.tables.pages.push(long, later, trashed);
    fake.tables.schedules = [long, later, trashed].map((p) => ({ id: `${p.id}::m1`, sourcePageId: p.id, workspaceId: WS, startAt: "x", endAt: "z" }));
    const all = await listSchedulesTool(ctx, { from: "2026-03-10", to: "2026-03-12" });
    expect(all.schedules.map((s) => s.id)).toEqual(["long::m1", "long::m2"]);
    expect(all.schedules[0]).toMatchObject({ status: "progress", startDate: "2026-01-02", endDate: "2026-04-01", assigneeName: "Alice" });
    const bob = await listSchedulesTool(ctx, { from: "2026-03-10", to: "2026-03-12", assignee: "m2" });
    expect(bob.schedules.map((s) => s.id)).toEqual(["long::m2"]);
  });
});

describe("스케줄러 접근 인가", () => {
  it("read 토큰은 쓰기 거부, 토큰 범위 밖이면 not found", async () => {
    const { ctx } = setup({ token: { scopes: ["read"] } });
    await expect(createScheduleTool(ctx, { startDate: "2026-03-10" })).rejects.toThrow(/write scope/);
    const scoped = setup({ token: { scopes: ["read", "write"], workspaceIds: ["ws-a"] } });
    await expect(createScheduleTool(scoped.ctx, { startDate: "2026-03-10" })).rejects.toThrow(/Not found/);
    await expect(listSchedulesTool(scoped.ctx, { from: "2026-03-10" })).rejects.toThrow(/Not found/);
  });

  it("작업 DB 는 범용 툴 거부, 마일스톤 행은 create_pages·update_page 허용(연결 select 는 원시 id), 스키마 변경은 거부", async () => {
    const { ctx, fake } = setup();
    fake.tables.pages.push(scheduleRow("row1", {}));
    await expect(createPagesTool(ctx, { parent: { databaseId: DB }, pages: [{ title: "x" }] })).rejects.toThrow(/Not found/);
    await expect(updatePageTool(ctx, { pageId: "row1", title: "x" })).rejects.toThrow(/Not found/);
    await expect(createPagesTool(ctx, { parent: { workspaceId: WS }, pages: [{ title: "x" }] })).rejects.toThrow(/Not found/);
    const r = await createPagesTool(ctx, { parent: { databaseId: MILESTONE_DB }, pages: [{ title: "M1", properties: { 목표: "출시", 프로젝트: "p1" } }] });
    const id = r.pages[0].id;
    expect(JSON.parse(String(pageOf(fake, id).dbCells))).toEqual({ "lc-milestone:goal": "출시", "lc-milestone:project": "p1" });
    await updatePageTool(ctx, { pageId: id, properties: { 목표: "베타" } });
    expect(JSON.parse(String(pageOf(fake, id).dbCells))["lc-milestone:goal"]).toBe("베타");
    await expect(updateDatabaseTool(ctx, { databaseId: MILESTONE_DB, title: "y" })).rejects.toThrow(/scheduler/);
  });
});

describe("프로젝트·공휴일", () => {
  it("프로젝트 CRUD: 멤버 이메일 해석·리더는 멤버만, 없는 id 수정 거부, 삭제는 confirm", async () => {
    const { ctx, fake } = setup();
    const created = await createSchedulerProjectTool(ctx, { name: "Beta", members: ["bob@example.com", "m1"], leaders: ["m2", "m3"] });
    expect(created).toMatchObject({ name: "Beta", color: "#3b82f6", memberIds: ["m2", "m1"], leaderMemberIds: ["m2"], workspaceId: WS });
    const updated = await updateSchedulerProjectTool(ctx, { id: created.id, name: "Beta2", isHidden: true });
    expect(updated).toMatchObject({ name: "Beta2", isHidden: true });
    await expect(updateSchedulerProjectTool(ctx, { id: "nope", name: "x" })).rejects.toThrow(/Unknown scheduler project/);
    expect((await listSchedulerProjectsTool(ctx, { includeHidden: false })).projects.map((p) => p.name)).toEqual(["Alpha"]);
    await expect(deleteSchedulerProjectTool(ctx, { id: created.id } as never)).rejects.toThrow();
    await deleteSchedulerProjectTool(ctx, { id: created.id, confirm: true });
    expect(fake.tables.projects.map((p) => p.id)).toEqual(["p1"]);
  });

  it("공휴일 생성·연도 필터·삭제", async () => {
    const { ctx, fake } = setup();
    const h = await createHolidayTool(ctx, { title: "창립기념일", date: "2026-05-15" });
    expect(h).toMatchObject({ type: "holiday", color: "#3498DB", workspaceId: WS });
    await createHolidayTool(ctx, { title: "워크샵", date: "2027-01-10", type: "meeting" });
    expect((await listHolidaysTool(ctx, { year: 2026 })).holidays.map((x) => x.title)).toEqual(["창립기념일"]);
    await expect(createHolidayTool(ctx, { title: "x", date: "2026-13-01" })).rejects.toThrow(/valid YYYY-MM-DD/);
    await deleteHolidayTool(ctx, { id: h.id, confirm: true });
    expect(fake.tables.holidays.map((x) => x.title)).toEqual(["워크샵"]);
  });
});

describe("주간 MM — 리졸버 권한 그대로", () => {
  const buckets = [
    { id: "project:p1", kind: "project" as const, scopeId: "p1", label: "Alpha", ratioBp: 8000 },
    { id: "other", kind: "other" as const, label: "기타", ratioBp: 2000 },
  ];

  it("본인 입력·월요일 검증, 일반 멤버는 타인 입력·리뷰·잠금 거부(Rejected)", async () => {
    const { ctx, fake } = setup();
    const entry = await upsertMmEntryTool(ctx, { weekStart: "2026-03-09", buckets });
    expect(entry).toMatchObject({ memberId: "m1", weekEnd: "2026-03-13", status: "submitted" });
    expect(entry.buckets[1]).toMatchObject({ editable: false, reasons: [] });
    await expect(upsertMmEntryTool(ctx, { weekStart: "2026-03-10", buckets })).rejects.toThrow(/Monday/);
    const other = await runTool(ctx, "upsert_mm_entry", {}, () => upsertMmEntryTool(ctx, { weekStart: "2026-03-09", member: "m2", buckets }));
    expect(other).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/^Rejected: /) }] });
    const review = await runTool(ctx, "review_mm_entry", {}, () => reviewMmEntryTool(ctx, { entryId: entry.id }));
    expect(review.isError).toBe(true);
    const lock = await runTool(ctx, "set_mm_entry_lock", {}, () => setMmEntryLockTool(ctx, { entryId: entry.id, locked: true }));
    expect(lock.isError).toBe(true);
    expect(fake.tables["mm-entries"].filter((r) => r.recordType === "entry")).toHaveLength(1);
  });

  it("관리자: 타인 입력·리뷰·잠금, 잠금된 항목은 수정 거부, 합계 100% 아니면 거부", async () => {
    const { ctx } = setup({ caller: { workspaceRole: "manager" } });
    const entry = await upsertMmEntryTool(ctx, { weekStart: "2026-03-09", member: "bob@example.com", buckets });
    expect(entry.memberId).toBe("m2");
    expect(await reviewMmEntryTool(ctx, { entryId: entry.id, note: "ok" })).toMatchObject({ status: "reviewed", reviewedByMemberId: "m1" });
    expect(await setMmEntryLockTool(ctx, { entryId: entry.id, locked: true })).toMatchObject({ status: "locked" });
    await expect(upsertMmEntryTool(ctx, { weekStart: "2026-03-09", member: "m2", buckets })).rejects.toThrow(/잠금/);
    await expect(upsertMmEntryTool(ctx, { weekStart: "2026-03-16", buckets: [{ ...buckets[0], ratioBp: 5000 }] })).rejects.toThrow(/100%/);
    const listed = await listMmEntriesTool(ctx, { fromWeekStart: "2026-03-09", member: "m2", includeRevisions: true });
    expect(listed.entries).toHaveLength(1);
    expect((listed.entries[0] as unknown as { revisions: { action: string }[] }).revisions.map((r) => r.action).sort()).toEqual(["lock", "review", "submit"]);
  });
});
