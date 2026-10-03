import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSeedUpdate, schemaFromSpec } from "../../_shared/collabContent";
import { NOT_ACCESSIBLE } from "../access";
import { getCommentsTool } from "../tools/comments";
import { capOutput, fetchTool } from "../tools/fetch";
import { listWorkspacesTool } from "../tools/listWorkspaces";
import { MAX_BODY_CANDIDATES, rankTitleMatches, searchTool, titleRank } from "../tools/search";
import { getUsersTool } from "../tools/users";
import type { PageMeta } from "../pageScan";
import { baseTables, makeCtx } from "./fixtures";
import type { Item } from "./fakeDdb";

const roomStates = new Map<string, Uint8Array>();
vi.mock("../../realtime/yjsStore", () => ({
  loadPageState: vi.fn(async (room: string) => roomStates.get(room) ?? new Uint8Array([0, 0])),
}));

function para(text: string) {
  return { type: "paragraph", content: [{ type: "text", text }] };
}
function docOf(...texts: string[]) {
  return { type: "doc", content: texts.map(para) };
}
function page(id: string, overrides: Item = {}): Item {
  return { id, workspaceId: "ws-a", title: id, updatedAt: "2026-09-01T00:00:00.000Z", ...overrides };
}

beforeEach(() => roomStates.clear());

describe("워크스페이스 인가", () => {
  it("list_workspaces 는 멤버 접근 ∩ 토큰 범위만 돌려준다", async () => {
    const all = await listWorkspacesTool(makeCtx().ctx);
    expect(all.workspaces.map((w) => w.id)).toEqual(expect.arrayContaining(["ws-a", "ws-b"]));
    expect(all.workspaces.map((w) => w.id)).not.toContain("ws-c");

    const scoped = await listWorkspacesTool(makeCtx(baseTables(), { workspaceIds: ["ws-b"] }).ctx);
    expect(scoped.workspaces.map((w) => w.id)).toEqual(["ws-b"]);
  });

  it("토큰 범위 밖 워크스페이스의 페이지는 fetch 거부", async () => {
    const tables = baseTables();
    tables.pages = [page("p1", { doc: JSON.stringify(docOf("hello")) })];
    const { ctx } = makeCtx(tables, { workspaceIds: ["ws-b"] });
    await expect(fetchTool(ctx, { id: "p1" })).rejects.toThrow(NOT_ACCESSIBLE);
  });

  it("멤버십 밖 워크스페이스는 fetch·search·get_comments·get_users 거부", async () => {
    const tables = baseTables();
    tables.pages = [page("pc", { workspaceId: "ws-c" })];
    const { ctx } = makeCtx(tables);
    await expect(fetchTool(ctx, { id: "pc" })).rejects.toThrow(NOT_ACCESSIBLE);
    await expect(searchTool(ctx, { query: "pc", workspaceId: "ws-c" })).rejects.toThrow(NOT_ACCESSIBLE);
    await expect(getCommentsTool(ctx, { pageId: "pc" })).rejects.toThrow(NOT_ACCESSIBLE);
    await expect(getUsersTool(ctx, { workspaceId: "ws-c" })).rejects.toThrow(NOT_ACCESSIBLE);
  });
});

describe("개인 워크스페이스", () => {
  it("상위 역할이어도 타인의 개인 워크스페이스는 MCP 로 읽을 수 없고, 본인 것은 읽는다", async () => {
    const tables = baseTables();
    tables.workspaces.push(
      { workspaceId: "ws-personal-m2", name: "Bob personal", type: "personal", ownerMemberId: "m2", createdAt: "x" },
      { workspaceId: "ws-personal-m1", name: "Mine", type: "personal", ownerMemberId: "m1", createdAt: "x" },
    );
    tables.pages = [
      page("secret", { workspaceId: "ws-personal-m2", doc: JSON.stringify(docOf("private")) }),
      page("mine", { workspaceId: "ws-personal-m1", doc: JSON.stringify(docOf("my note")) }),
    ];
    const { ctx } = makeCtx(tables);
    const owner = { ...ctx, caller: { ...ctx.caller, workspaceRole: "owner" as const } };
    await expect(fetchTool(owner, { id: "secret" })).rejects.toThrow(NOT_ACCESSIBLE);
    await expect(searchTool(owner, { query: "secret", workspaceId: "ws-personal-m2" })).rejects.toThrow(NOT_ACCESSIBLE);
    await expect(getCommentsTool(owner, { pageId: "secret" })).rejects.toThrow(NOT_ACCESSIBLE);
    // 다른 공유 워크스페이스는 기존 역할 규칙(owner 전체 접근) 유지
    tables.pages.push(page("shared-c", { workspaceId: "ws-c", doc: JSON.stringify(docOf("shared")) }));
    await expect(fetchTool(owner, { id: "shared-c" })).resolves.toContain("shared");

    const mineCtx = { ...owner, caller: { ...owner.caller, personalWorkspaceId: "ws-personal-m1" } };
    await expect(fetchTool(mineCtx, { id: "mine" })).resolves.toContain("my note");
  });
});

describe("search", () => {
  it("제목 순위: 정확 > 접두 > 포함, 동순위는 최신순", () => {
    expect(titleRank("Plan", "plan")).toBe(0);
    expect(titleRank("Planning", "plan")).toBe(1);
    expect(titleRank("My plan", "plan")).toBe(2);
    expect(titleRank("Other", "plan")).toBeNull();
    const meta = (id: string, title: string, updatedAt: string): PageMeta => ({
      id, title, updatedAt, workspaceId: "ws-a", parentId: null, databaseId: null, deleted: false,
    });
    const ranked = rankTitleMatches(
      [meta("c", "My plan", "3"), meta("b1", "Planning", "1"), meta("b2", "Plan B", "2"), meta("a", "plan", "0")],
      "plan",
    );
    expect(ranked.map((m) => m.id)).toEqual(["a", "b2", "b1", "c"]);
  });

  it("휴지통 제외, 본문 매칭은 남는 자리에서 최신 40건까지만, 경로·타입 포함", async () => {
    const tables = baseTables();
    tables.pages = [
      page("root", { title: "Root" }),
      page("t1", { title: "Roadmap", parentId: "root", updatedAt: "2026-09-02" }),
      page("trashed", { title: "Roadmap old", deletedAt: "2026-09-03" }),
      page("row", { title: "roadmap row", databaseId: "db1" }),
      ...Array.from({ length: MAX_BODY_CANDIDATES + 5 }, (_, i) =>
        page(`b${i}`, { updatedAt: `2026-08-${String(10 + i).padStart(2, "0")}`, doc: JSON.stringify(docOf("see roadmap here")) }),
      ),
    ];
    const { ctx } = makeCtx(tables);
    const r = await searchTool(ctx, { query: "roadmap", workspaceId: "ws-a", limit: 25 });
    const ids = r.results.map((x) => x.id);
    expect(ids.slice(0, 2)).toEqual(["t1", "row"]);
    expect(ids).not.toContain("trashed");
    expect(r.results[0]).toMatchObject({ path: ["Root"], type: "page", match: "title" });
    expect(r.results[1].type).toBe("database-row");
    const body = r.results.filter((x) => x.match === "body");
    expect(body.length).toBe(23);
    expect(body[0].snippet).toContain("roadmap");
    expect(r.bodySearchedPages).toBeLessThanOrEqual(MAX_BODY_CANDIDATES);
    expect(r.truncated).toBe(false);
  });

  it("메타 스캔 상한에 걸리면 truncated", async () => {
    const tables = baseTables();
    tables.pages = Array.from({ length: 5003 }, (_, i) => page(`p${i}`));
    const r = await searchTool(makeCtx(tables).ctx, { query: "zzz", workspaceId: "ws-a" });
    expect(r.scannedPages).toBe(5000);
    expect(r.truncated).toBe(true);
  });
});

describe("fetch", () => {
  it("협업 룸 상태를 Pages.doc 보다 우선한다", async () => {
    const tables = baseTables();
    tables.pages = [page("p1", { title: "Doc", doc: JSON.stringify(docOf("stale snapshot")) })];
    roomStates.set("v5:p1", buildSeedUpdate(schemaFromSpec(), docOf("live collab text")));
    const out = await fetchTool(makeCtx(tables).ctx, { id: "p1" });
    expect(out).toContain("live collab text");
    expect(out).not.toContain("stale snapshot");
    expect(out).toContain("bodySource: collab");
  });

  it("룸이 비어 있으면 Pages.doc 을 쓰고 하위 페이지를 나열한다", async () => {
    const tables = baseTables();
    tables.pages = [
      page("p1", { title: "Parent", doc: JSON.stringify(docOf("stored body")) }),
      page("c1", { title: "Kid", parentId: "p1" }),
      page("c2", { title: "Gone", parentId: "p1", deletedAt: "2026-09-09" }),
    ];
    const out = await fetchTool(makeCtx(tables).ctx, { id: "p1" });
    expect(out).toContain("stored body");
    expect(out).toContain("bodySource: pages");
    expect(out).toContain('<mention-page id="c1"/> Kid');
    expect(out).not.toContain("Gone");
  });

  it("DB 행은 컬럼 정의로 속성을 렌더한다", async () => {
    const tables = baseTables();
    tables.databases = [{
      id: "db1", workspaceId: "ws-a", title: "Tasks",
      columns: JSON.stringify([
        { id: "c-title", name: "Name", type: "title" },
        { id: "c-status", name: "Status", type: "status", config: { options: [{ id: "o1", label: "Done" }] } },
        { id: "c-owner", name: "Owner", type: "person" },
        { id: "c-due", name: "Due", type: "date" },
        { id: "c-ok", name: "OK", type: "checkbox" },
      ]),
    }];
    tables.pages = [page("r1", {
      title: "Task 1", databaseId: "db1",
      dbCells: JSON.stringify({ "c-status": "o1", "c-owner": ["m2"], "c-due": { start: "2026-10-01" }, "c-ok": true }),
    })];
    const out = await fetchTool(makeCtx(tables).ctx, { id: "r1" });
    expect(out).toContain("type: database-row");
    expect(out).toContain("database: Tasks (id: db1)");
    expect(out).toContain("- Status: Done");
    expect(out).toContain("- Owner: Bob");
    expect(out).toContain("- Due: 2026-10-01");
    expect(out).toContain("- OK: true");
  });

  it("DB id 는 스키마·행 표를 돌려준다", async () => {
    const tables = baseTables();
    tables.databases = [{ id: "db1", workspaceId: "ws-a", title: "Tasks", columns: JSON.stringify([{ id: "t", name: "Name", type: "title" }]) }];
    tables.pages = [page("r1", { title: "Row A", databaseId: "db1", order: "a" })];
    const out = await fetchTool(makeCtx(tables).ctx, { id: "db1" });
    expect(out).toContain("type: database");
    expect(out).toContain("- Name (title, id: t)");
    expect(out).toContain("| r1 | Row A |");
  });

  it("휴지통 페이지는 includeTrashed 일 때만", async () => {
    const tables = baseTables();
    tables.pages = [page("p1", { deletedAt: "2026-09-09", doc: JSON.stringify(docOf("x")) })];
    const { ctx } = makeCtx(tables);
    await expect(fetchTool(ctx, { id: "p1" })).rejects.toThrow(/trash/);
    await expect(fetchTool(ctx, { id: "p1", includeTrashed: true })).resolves.toContain("trashed: true");
  });

  it("출력 상한 초과 시 잘라내고 안내를 붙인다", async () => {
    expect(capOutput("abc", 10)).toBe("abc");
    const capped = capOutput("가".repeat(100), 50);
    expect(capped).toMatch(/^가+\n\n\[truncated/);
    expect(Buffer.byteLength(capped.split("\n\n[")[0])).toBeLessThanOrEqual(50);

    const tables = baseTables();
    tables.pages = [page("big", { doc: JSON.stringify(docOf(...Array.from({ length: 3000 }, () => "x".repeat(100)))) })];
    const out = await fetchTool(makeCtx(tables).ctx, { id: "big" });
    expect(out).toContain("[truncated: output exceeded 200KB");
  });
});

describe("get_users / get_comments", () => {
  it("workspaceId 지정 시 접근 가능한 멤버만", async () => {
    const all = await getUsersTool(makeCtx().ctx, {});
    expect(all.users.map((u) => u.id)).toEqual(["m1", "m2"]);
    const wsA = await getUsersTool(makeCtx().ctx, { workspaceId: "ws-a" });
    expect(wsA.users).toEqual([{ id: "m1", name: "Alice", email: "m1@example.com" }]);
  });

  it("범위 토큰이 workspaceId 없이 호출하면 범위 내 워크스페이스 멤버 합집합만, Scan 은 요청당 1회", async () => {
    const tables = baseTables();
    tables.members.push({ memberId: "m3", name: "Carol", email: "c@example.com", status: "active", workspaceRole: "member", jobRole: "x" });
    tables["workspace-access"].push(
      { workspaceId: "ws-b", subjectKey: "team#t1", subjectType: "team", subjectId: "t1", level: "view" },
      { workspaceId: "ws-a", subjectKey: "member#m3", subjectType: "member", subjectId: "m3", level: "view" },
    );
    tables["member-teams"].push({ memberId: "m2", teamId: "t1" });
    const { ctx, fake } = makeCtx(tables, { workspaceIds: ["ws-b", "ws-c"] });
    const r = await getUsersTool(ctx, {});
    // ws-c 는 멤버십 밖이라 제외 → ws-b 의 m1(직접)·m2(팀)만, ws-a 전용 m3 는 제외
    expect(r.users.map((u) => u.id)).toEqual(["m1", "m2"]);
    expect(Object.keys(r.users[0]).sort()).toEqual(["email", "id", "name"]);
    const scans = fake.calls.filter((c) => c.constructor.name === "ScanCommand").map((c) => c.input.TableName);
    expect(scans.filter((t) => t === "members")).toHaveLength(1);
    expect(scans.filter((t) => t === "member-teams")).toHaveLength(1);
  });

  it("범위 토큰의 워크스페이스가 모두 접근 불가면 빈 목록(Scan 없음)", async () => {
    const { ctx, fake } = makeCtx(baseTables(), { workspaceIds: ["ws-c"] });
    expect(await getUsersTool(ctx, {})).toEqual({ users: [] });
    expect(fake.calls.some((c) => c.constructor.name === "ScanCommand")).toBe(false);
  });

  it("페이지 댓글(테이블+레거시)을 작성자 이름과 함께, 삭제분 제외", async () => {
    const tables = baseTables();
    tables.pages = [page("p1", {
      blockComments: JSON.stringify({ messages: [{ id: "legacy", pageId: "p1", blockId: "b1", authorMemberId: "m1", bodyText: "old", parentId: null, createdAt: 1 }] }),
    })];
    tables.comments = [
      { id: "c1", workspaceId: "ws-a", pageId: "p1", blockId: "b1", authorMemberId: "m2", bodyText: "hi", parentId: null, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01" },
      { id: "c2", workspaceId: "ws-a", pageId: "p1", blockId: "b1", authorMemberId: "m2", bodyText: "deleted", deletedAt: "x", createdAt: "2026-09-02", updatedAt: "2026-09-02" },
      { id: "c3", workspaceId: "ws-a", pageId: "other", blockId: "b9", authorMemberId: "m2", bodyText: "elsewhere", createdAt: "2026-09-03", updatedAt: "2026-09-03" },
    ];
    const r = await getCommentsTool(makeCtx(tables).ctx, { pageId: "p1" });
    expect(r.comments.map((c) => [c.id, c.author, c.body])).toEqual([
      ["legacy", "Alice", "old"],
      ["c1", "Bob", "hi"],
    ]);
  });
});
