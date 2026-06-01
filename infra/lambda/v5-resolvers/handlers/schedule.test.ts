import { BatchGetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";
import { listSchedules } from "./schedule";
import type { Member, Tables } from "./member";

const tables: Tables = {
  Members: "M",
  Teams: "T",
  MemberTeams: "MT",
  Workspaces: "W",
  WorkspaceAccess: "WA",
  Schedules: "S",
};

const caller: Member = {
  memberId: "m1",
  email: "m1@x.com",
  name: "M1",
  jobRole: "Eng",
  workspaceRole: "member",
  status: "active",
  personalWorkspaceId: "ws-1",
  cognitoSub: "sub-1",
  createdAt: "2026-01-01T00:00:00Z",
};

describe("schedule handlers", () => {
  it("listSchedules: range query에 선택 필터를 DynamoDB FilterExpression으로 붙인다", async () => {
    const sent: unknown[] = [];
    const doc = {
      send: vi.fn(async (command: unknown) => {
        sent.push(command);
        return { Items: [] };
      }),
    };

    await listSchedules({
      doc: doc as unknown as DynamoDBDocumentClient,
      tables,
      caller,
      workspaceId: "lc-scheduler-global",
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-06-30T23:59:59.999Z",
      organizationId: "org-1",
      teamId: "team-1",
      projectId: "project-1",
      assigneeId: "member-1",
    });

    const query = sent[0] as QueryCommand;
    expect(query.input).toMatchObject({
      TableName: "S",
      IndexName: "byWorkspaceAndStartAt",
      FilterExpression: "#organizationId = :organizationId AND #teamId = :teamId AND #projectId = :projectId AND #assigneeId = :assigneeId",
      ExpressionAttributeNames: {
        "#organizationId": "organizationId",
        "#teamId": "teamId",
        "#projectId": "projectId",
        "#assigneeId": "assigneeId",
      },
      ExpressionAttributeValues: {
        ":organizationId": "org-1",
        ":teamId": "team-1",
        ":projectId": "project-1",
        ":assigneeId": "member-1",
      },
    });
  });

  it("listSchedules: sourcePageId가 있으면 원본 page snapshot을 함께 반환한다", async () => {
    const sent: unknown[] = [];
    const doc = {
      send: vi.fn(async (command: unknown) => {
        sent.push(command);
        if (command instanceof QueryCommand) {
          return {
            Items: [
              {
                id: "page-1::member-1",
                sourcePageId: "page-1",
                workspaceId: "lc-scheduler-global",
                title: "일정 A",
                startAt: "2026-06-01T00:00:00.000Z",
                endAt: "2026-06-01T23:59:59.999Z",
                createdByMemberId: "m1",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-06-01T00:00:00.000Z",
              },
            ],
          };
        }
        return {
          Responses: {
            P: [
              {
                id: "page-1",
                workspaceId: "lc-scheduler-global",
                databaseId: "lc-scheduler-db:lc-scheduler-global",
                title: "일정 A",
                doc: "{}",
                dbCells: "{}",
                order: "a",
                createdByMemberId: "m1",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-06-01T00:00:00.000Z",
              },
            ],
          },
        };
      }),
    };

    const result = await listSchedules({
      doc: doc as unknown as DynamoDBDocumentClient,
      tables: { ...tables, Pages: "P" },
      caller,
      workspaceId: "lc-scheduler-global",
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-06-30T23:59:59.999Z",
    });

    expect(sent.some((command) => command instanceof BatchGetCommand)).toBe(true);
    expect(result[0]).toMatchObject({
      id: "page-1::member-1",
      sourcePage: {
        id: "page-1",
        workspaceId: "lc-scheduler-global",
      },
    });
  });
});
