import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it } from "vitest";
import {
  buildLCScheduleIndexRecords,
  removeLCScheduleIndexForPage,
  syncLCScheduleIndexForPage,
} from "./lcScheduleIndex";

const tables = { Schedules: "Schedules" };

function page(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "page-1",
    workspaceId: "lc-scheduler-global",
    databaseId: "lc-scheduler-db:lc-scheduler-global",
    title: "일정 A",
    createdByMemberId: "member-author",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z",
    dbCells: {
      "lc-scheduler:period": {
        start: "2026-06-10T00:00:00.000Z",
        end: "2026-06-12T23:59:59.999Z",
      },
      "lc-scheduler:assignees": ["member-a", "member-b"],
      "lc-scheduler:project": "project-1",
      "lc-scheduler:team": "team-1",
      "lc-scheduler:organization": "org-1",
      "lc-scheduler:color": "#3498DB",
      "lc-scheduler:meta": { kind: "schedule", rowIndexByAssigneeId: { "member-a": 2 } },
    },
    ...overrides,
  };
}

describe("LC schedule index", () => {
  it("LC schedule page를 assignee별 schedule index row로 투영한다", () => {
    const records = buildLCScheduleIndexRecords(page());

    expect(records).toHaveLength(2);
    expect(records.map((record) => record.id)).toEqual([
      "page-1::member-a",
      "page-1::member-b",
    ]);
    expect(records[0]).toMatchObject({
      sourcePageId: "page-1",
      workspaceId: "lc-scheduler-global",
      startAt: "2026-06-10T00:00:00.000Z",
      endAt: "2026-06-12T23:59:59.999Z",
      assigneeId: "member-a",
      projectId: "project-1",
      teamId: "team-1",
      organizationId: "org-1",
      rowIndex: 2,
    });
  });

  it("일정 기간이 없거나 LC schedule DB가 아니면 index row를 만들지 않는다", () => {
    expect(buildLCScheduleIndexRecords(page({ databaseId: "other-db" }))).toEqual([]);
    expect(buildLCScheduleIndexRecords(page({ dbCells: {} }))).toEqual([]);
  });

  it("page 저장 시 이전 index row를 지우고 현재 row를 쓴다", async () => {
    const sent: unknown[] = [];
    const doc = {
      send: async (command: unknown) => {
        sent.push(command);
        return {};
      },
    };

    await syncLCScheduleIndexForPage({
      doc: doc as unknown as DynamoDBDocumentClient,
      tables,
      before: page({
        dbCells: {
          ...(page().dbCells as Record<string, unknown>),
          "lc-scheduler:assignees": ["member-old"],
        },
      }),
      after: page(),
    });

    const batch = sent[0] as BatchWriteCommand;
    const requests = batch.input.RequestItems?.Schedules ?? [];
    expect(requests).toHaveLength(3);
    expect(requests[0]).toMatchObject({ DeleteRequest: { Key: { id: "page-1::member-old" } } });
    expect(requests[1]).toMatchObject({ PutRequest: { Item: { id: "page-1::member-a" } } });
    expect(requests[2]).toMatchObject({ PutRequest: { Item: { id: "page-1::member-b" } } });
  });

  it("page 삭제 시 기존 index row만 삭제한다", async () => {
    const sent: unknown[] = [];
    const doc = {
      send: async (command: unknown) => {
        sent.push(command);
        return {};
      },
    };

    await removeLCScheduleIndexForPage({
      doc: doc as unknown as DynamoDBDocumentClient,
      tables,
      page: page({ deletedAt: "2026-06-03T00:00:00.000Z" }),
    });

    const batch = sent[0] as BatchWriteCommand;
    const requests = batch.input.RequestItems?.Schedules ?? [];
    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.DeleteRequest?.Key?.id)).toEqual([
      "page-1::member-a",
      "page-1::member-b",
    ]);
  });
});
