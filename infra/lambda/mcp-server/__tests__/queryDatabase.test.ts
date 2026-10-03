import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyFilterSortSearch } from "../../../../src/lib/databaseQuery";
import type { ColumnDef, FilterRule, SortRule } from "../../../../src/types/database";
import { loadDatabaseRows, parseColumnDefs, toRowView } from "../dbRows";
import { queryDatabaseTool } from "../tools/queryDatabase";
import { resetCollabMocks } from "./collabMocks";
import { COLUMNS, ROWS, row, setupDb } from "./dbFixtures";

vi.mock("../../realtime/yjsStore", async () => (await import("./collabMocks")).yjsStoreMock);
vi.mock("../wsBroadcast", async () => (await import("./collabMocks")).broadcastMock);
vi.mock("../publish", async () => (await import("./collabMocks")).publishMock);

beforeEach(() => resetCollabMocks());

function rowIds(text: string): string[] {
  return JSON.parse(/rowIds: (.*)/.exec(text)?.[1] ?? "[]");
}

describe("query_database", () => {
  it("행 순서는 클라와 같다(order 숫자 오름차순, 템플릿 제외)", async () => {
    const { ctx } = setupDb();
    const text = await queryDatabaseTool(ctx, { databaseId: "db1" });
    expect(rowIds(text)).toEqual(["r1", "r2", "r4", "r3"]);
    expect(text).toContain("| id | title | Status | Tags | Points |");
    expect(text).toContain("| r1 | Alpha | Todo | red | 5 |");
  });

  it("사람 값 필터 → 클라 FilterRule 변환(옵션 라벨·이메일·날짜·체크박스·숫자)", async () => {
    const { ctx } = setupDb();
    const q = async (filter: unknown[]) => rowIds(await queryDatabaseTool(ctx, { databaseId: "db1", filter: filter as never }));
    expect(await q([{ column: "Status", operator: "equals", value: "todo" }])).toEqual(["r1", "r3"]);
    expect(await q([{ column: "Tags", operator: "contains", value: ["blue"] }])).toEqual(["r2"]);
    expect(await q([{ column: "Owner", operator: "equals", value: "bob@example.com" }])).toEqual(["r2"]);
    // 앱과 같은 의미: lt 는 문자열 비교라 빈 날짜("")도 통과한다 — 앱 뷰와 결과를 맞춘다.
    expect(await q([{ column: "Due", operator: "lt", value: "2026-09-30" }])).toEqual(["r2", "r4", "r3"]);
    expect(await q([{ column: "Due", operator: "lt", value: "2026-09-30" }, { column: "Due", operator: "isNotEmpty" }])).toEqual(["r2"]);
    expect(await q([{ column: "Done?", operator: "equals", value: true }])).toEqual(["r1"]);
    expect(await q([{ column: "Points", operator: "gt", value: 6 }])).toEqual(["r2", "r4"]);
    expect(await q([{ column: "Status", operator: "isEmpty" }])).toEqual(["r4"]);
    expect(await q([{ column: "Status", operator: "notEquals", value: "Done" }, { column: "Points", operator: "gt", value: "2" }])).toEqual(["r1", "r4"]);
  });

  it("검색·다중 정렬·커서 페이지", async () => {
    const { ctx } = setupDb();
    expect(rowIds(await queryDatabaseTool(ctx, { databaseId: "db1", search: "urgent" }))).toEqual(["r3"]);
    const sorted = await queryDatabaseTool(ctx, { databaseId: "db1", sorts: [{ column: "Points", direction: "desc" }], limit: 2 });
    expect(rowIds(sorted)).toEqual(["r2", "r4"]);
    const cursor = /nextCursor: (\S+)/.exec(sorted)?.[1];
    expect(cursor).toBeTruthy();
    const next = await queryDatabaseTool(ctx, { databaseId: "db1", sorts: [{ column: "Points", direction: "desc" }], limit: 2, cursor });
    expect(rowIds(next)).toEqual(["r1", "r3"]);
    expect(next).not.toContain("nextCursor");
  });

  it("미지 컬럼·옵션·연산자는 유효 목록과 함께 오류", async () => {
    const { ctx } = setupDb();
    await expect(queryDatabaseTool(ctx, { databaseId: "db1", filter: [{ column: "Nope", operator: "equals", value: "x" }] }))
      .rejects.toThrow(/Unknown property "Nope". Columns: Name \(title\), Status \(status\)/);
    await expect(queryDatabaseTool(ctx, { databaseId: "db1", filter: [{ column: "Status", operator: "equals", value: "Blocked" }] }))
      .rejects.toThrow(/Valid options: Todo, Done/);
    await expect(queryDatabaseTool(ctx, { databaseId: "db1", filter: [{ column: "Status", operator: "like" as never, value: "x" }] }))
      .rejects.toThrow(/contains.*isNotEmpty/);
    await expect(queryDatabaseTool(ctx, { databaseId: "db1", filter: [{ column: "Due", operator: "gt", value: "next week" }] }))
      .rejects.toThrow(/YYYY-MM-DD/);
    await expect(queryDatabaseTool(ctx, { databaseId: "db1", cursor: "garbage" })).rejects.toThrow(/Invalid cursor/);
  });

  it("권한 밖 DB 는 숨기고, 5000행 상한은 truncated 로 알린다", async () => {
    const outsider = setupDb({ token: { workspaceIds: ["ws-b"] } });
    await expect(queryDatabaseTool(outsider.ctx, { databaseId: "db1" })).rejects.toThrow(/Not found or not accessible/);
    const many = Array.from({ length: 5003 }, (_, i) => row(`x${i}`, `Row ${i}`, i));
    const { ctx } = setupDb({ rows: many });
    const text = await queryDatabaseTool(ctx, { databaseId: "db1", limit: 1 });
    expect(text).toContain("truncated: true");
    expect(text).toContain("scannedRows: 5000");
  });

  it("행은 프로젝션으로 읽고(본문 doc 제외), 1000행당 분당 rate limit 1 unit 추가 차감(리뷰 M2)", async () => {
    const many = Array.from({ length: 2500 }, (_, i) => row(`x${i}`, `Row ${i}`, i));
    const { ctx, fake } = setupDb({ rows: many });
    await queryDatabaseTool(ctx, { databaseId: "db1", limit: 1 });
    const queries = fake.calls.filter((c) => c.constructor.name === "QueryCommand" && c.input.IndexName === "byDatabaseAndOrder");
    expect(queries.length).toBeGreaterThan(0);
    const names = Object.values((queries[0].input.ExpressionAttributeNames ?? {}) as Record<string, string>);
    expect(names).toEqual(expect.arrayContaining(["id", "title", "dbCells", "order", "workspaceId", "deletedAt"]));
    expect(names).not.toContain("doc");
    const charge = fake.calls.find((c) => c.constructor.name === "UpdateCommand" && String((c.input.Key as Record<string, unknown>).pk).startsWith("mcp-rl#"));
    expect((charge?.input.ExpressionAttributeValues as Record<string, unknown>)[":one"]).toBe(2);
  });

  it("공유 모듈 일치: query 경로 결과 = 클라 applyFilterSortSearch 직접 호출", async () => {
    const { ctx } = setupDb();
    const db = { id: "db1", workspaceId: "ws-a", columns: JSON.stringify(COLUMNS) };
    const defs = parseColumnDefs(db.columns) as ColumnDef[];
    const views = (await loadDatabaseRows(ctx, db)).rows.map((r) => toRowView(r, "db1", defs));
    const cases: { search: string; filters: FilterRule[]; sorts: SortRule[]; tool: Record<string, unknown> }[] = [
      { search: "", filters: [{ id: "f0", columnId: "c-status", operator: "equals", value: "o-todo" }], sorts: [{ columnId: "c-pts", dir: "desc" }],
        tool: { filter: [{ column: "Status", operator: "equals", value: "Todo" }], sorts: [{ column: "Points", direction: "desc" }] } },
      { search: "a", filters: [{ id: "f0", columnId: "c-tags", operator: "isNotEmpty" }], sorts: [{ columnId: "c-due", dir: "asc" }],
        tool: { search: "a", filter: [{ column: "Tags", operator: "isNotEmpty" }], sorts: [{ column: "Due", direction: "asc" }] } },
      { search: "", filters: [], sorts: [{ columnId: "c-title", dir: "asc" }], tool: { sorts: [{ column: "Name", direction: "asc" }] } },
    ];
    for (const c of cases) {
      const expected = applyFilterSortSearch(views, defs, c.search, c.filters, c.sorts).map((r) => r.pageId);
      expect(rowIds(await queryDatabaseTool(ctx, { databaseId: "db1", limit: 100, ...c.tool }))).toEqual(expected);
    }
    expect(ROWS.length).toBe(5);
  });
});
