import { describe, expect, it, vi } from "vitest";
import {
  buildLCDatabaseRowMemberRecords,
  removeLCDatabaseRowMemberIndexForPage,
  syncLCDatabaseRowMemberIndexForPage,
} from "./lcDatabaseRowMemberIndex";

const tables = { DatabaseRowMembers: "DRM" } as const;

function taskPage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "page-1",
    workspaceId: "lc-scheduler-global",
    databaseId: "lc-scheduler-db:lc-scheduler-global",
    order: "5",
    updatedAt: "2026-06-04T00:00:00.000Z",
    dbCells: { "lc-scheduler:assignees": ["member-a", "member-b"] },
    ...overrides,
  };
}

function mockDoc() {
  const send = vi.fn().mockResolvedValue({});
  return { send } as unknown as import("@aws-sdk/lib-dynamodb").DynamoDBDocumentClient;
}

describe("lcDatabaseRowMemberIndex", () => {
  it("buildRecords: 작업 DB row 의 assignee 마다 레코드를 만든다(기간 조건 없음)", () => {
    const records = buildLCDatabaseRowMemberRecords(taskPage());
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      pk: "lc-scheduler-db:lc-scheduler-global#member-a",
      pageId: "page-1",
      memberId: "member-a",
      order: "5",
    });
    expect(records[1]!.memberId).toBe("member-b");
  });

  it("buildRecords: 작업 DB 가 아니면 빈 배열", () => {
    expect(
      buildLCDatabaseRowMemberRecords(
        taskPage({ databaseId: "lc-milestone-db:lc-scheduler-global" }),
      ),
    ).toEqual([]);
  });

  it("buildRecords: assignees 없으면 빈 배열", () => {
    expect(buildLCDatabaseRowMemberRecords(taskPage({ dbCells: {} }))).toEqual([]);
  });

  it("buildRecords: 삭제된 row 는 includeDeleted 없으면 제외", () => {
    expect(
      buildLCDatabaseRowMemberRecords(taskPage({ deletedAt: "2026-06-05T00:00:00.000Z" })),
    ).toEqual([]);
    expect(
      buildLCDatabaseRowMemberRecords(taskPage({ deletedAt: "2026-06-05T00:00:00.000Z" }), {
        includeDeleted: true,
      }),
    ).toHaveLength(2);
  });

  it("syncForPage: before/after diff 로 사라진 assignee 는 Delete, 현재 assignee 는 Put", async () => {
    const doc = mockDoc();
    const before = taskPage({
      dbCells: { "lc-scheduler:assignees": ["member-a", "member-b"] },
    });
    const after = taskPage({
      dbCells: { "lc-scheduler:assignees": ["member-a", "member-c"] },
    });
    await syncLCDatabaseRowMemberIndexForPage({ doc, tables, before, after });

    const sendMock = doc.send as unknown as ReturnType<typeof vi.fn>;
    const batch = sendMock.mock.calls[0]?.[0].input.RequestItems.DRM as Array<Record<string, unknown>>;
    const deletes = batch.filter((r) => "DeleteRequest" in r);
    const puts = batch.filter((r) => "PutRequest" in r);
    // member-b 는 빠졌으므로 Delete, member-a/member-c 는 Put.
    expect(deletes).toHaveLength(1);
    expect((deletes[0] as { DeleteRequest: { Key: { pk: string } } }).DeleteRequest.Key.pk).toContain(
      "member-b",
    );
    expect(puts).toHaveLength(2);
  });

  it("removeForPage: 모든 assignee 엔트리를 Delete", async () => {
    const doc = mockDoc();
    await removeLCDatabaseRowMemberIndexForPage({
      doc,
      tables,
      page: taskPage({ deletedAt: "2026-06-05T00:00:00.000Z" }),
    });
    const sendMock = doc.send as unknown as ReturnType<typeof vi.fn>;
    const batch = sendMock.mock.calls[0]?.[0].input.RequestItems.DRM as Array<Record<string, unknown>>;
    expect(batch).toHaveLength(2);
    expect(batch.every((r) => "DeleteRequest" in r)).toBe(true);
  });

  it("테이블 미설정 시 아무 것도 호출하지 않는다", async () => {
    const doc = mockDoc();
    await syncLCDatabaseRowMemberIndexForPage({
      doc,
      tables: {},
      before: null,
      after: taskPage(),
    });
    expect((doc.send as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});
