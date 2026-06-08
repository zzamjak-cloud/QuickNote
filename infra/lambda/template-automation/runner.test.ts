import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";
import { runTemplateAutomation } from "./runner";

const tables = {
  Members: "Members",
  Teams: "Teams",
  MemberTeams: "MemberTeams",
  Workspaces: "Workspaces",
  WorkspaceAccess: "WorkspaceAccess",
  Pages: "Pages",
  Databases: "Databases",
  TemplateAutomationRuns: "TemplateAutomationRuns",
};

const database = {
  id: "db-1",
  workspaceId: "ws-1",
  createdByMemberId: "member-1",
  columns: JSON.stringify([
    { id: "title", name: "Name", type: "title" },
    { id: "date", name: "Date", type: "date" },
  ]),
  panelState: JSON.stringify({ timelineDateColumnId: "date" }),
  templates: JSON.stringify([
    {
      id: "template-1",
      title: "QA",
      cells: {},
      pageId: "template-page-1",
      automation: {
        id: "automation-1",
        enabled: true,
        weekdays: [1],
        time: "09:30",
        timezone: "Asia/Seoul",
        titlePrefix: "QA",
        maxAttempts: 2,
      },
    },
  ]),
};

function mockDoc(
  overrides: {
    existingRun?: Record<string, unknown>;
    memberGetMiss?: boolean;
    databaseCreatedByMemberId?: string;
  } = {},
) {
  const send = vi.fn(async (command: unknown) => {
    if (command instanceof GetCommand) {
      const input = command.input;
      if (input.TableName === "TemplateAutomationRuns") return { Item: overrides.existingRun };
      if (input.TableName === "Databases") {
        return {
          Item: {
            ...database,
            createdByMemberId: overrides.databaseCreatedByMemberId ?? database.createdByMemberId,
          },
        };
      }
      if (input.TableName === "Pages" && input.Key?.id === "template-page-1") {
        return {
          Item: {
            id: "template-page-1",
            title: "QA Template",
            doc: "{\"type\":\"doc\"}",
            dbCells: { status: "todo", _qn_isTemplate: "1" },
          },
        };
      }
      if (input.TableName === "Pages") return { Item: undefined };
      if (input.TableName === "Members") {
        if (overrides.memberGetMiss) return { Item: undefined };
        return {
          Item: {
            memberId: "member-1",
            email: "member@example.com",
            name: "Member",
            jobRole: "PM",
            workspaceRole: "owner",
            status: "active",
            personalWorkspaceId: "ws-1",
            cognitoSub: "sub-1",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        };
      }
    }
    if (command instanceof QueryCommand) {
      if (command.input.TableName === "Members" && command.input.IndexName === "byCognitoSub") {
        return {
          Items: [
            {
              memberId: "member-1",
              email: "member@example.com",
              name: "Member",
              jobRole: "PM",
              workspaceRole: "owner",
              status: "active",
              personalWorkspaceId: "ws-1",
              cognitoSub: "b4484dec-1001-70c5-ad14-dcac460b6510",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        };
      }
    }
    if (command instanceof PutCommand) return {};
    throw new Error("unexpected command");
  });
  return { send } as unknown as import("@aws-sdk/lib-dynamodb").DynamoDBDocumentClient;
}

describe("template automation runner", () => {
  it("creates a deterministic page and records success", async () => {
    const doc = mockDoc();
    const upsertPageFn = vi.fn(async (args: { input: Record<string, unknown> }) => args.input);

    const result = await runTemplateAutomation({
      doc,
      tables,
      event: {
        type: "databaseTemplateAutomation",
        databaseId: "db-1",
        templateId: "template-1",
        automationId: "automation-1",
        scheduledTime: "2026-06-08T00:30:00.000Z",
      },
      now: () => new Date("2026-06-08T00:31:00.000Z"),
      upsertPageFn,
    });

    expect(result.status).toBe("succeeded");
    expect(upsertPageFn).toHaveBeenCalledTimes(1);
    expect(upsertPageFn.mock.calls[0]?.[0].input).toMatchObject({
      workspaceId: "ws-1",
      databaseId: "db-1",
      title: "QA 26/06/08",
      doc: "{\"type\":\"doc\"}",
      dbCells: {
        status: "todo",
        date: { start: "2026-06-08" },
      },
    });
    expect(upsertPageFn.mock.calls[0]?.[0].input.dbCells).not.toHaveProperty("_qn_isTemplate");
  });

  it("marks failed without creating a page after max attempts", async () => {
    const doc = mockDoc({ existingRun: { id: "run-1", attempts: 2, status: "failed" } });
    const upsertPageFn = vi.fn(async (args: { input: Record<string, unknown> }) => args.input);

    const result = await runTemplateAutomation({
      doc,
      tables,
      event: {
        type: "databaseTemplateAutomation",
        databaseId: "db-1",
        templateId: "template-1",
        automationId: "automation-1",
        scheduledTime: "2026-06-08T00:30:00.000Z",
      },
      now: () => new Date("2026-06-08T00:31:00.000Z"),
      upsertPageFn,
    });

    expect(result.status).toBe("failed");
    expect(upsertPageFn).not.toHaveBeenCalled();
  });

  it("resolves automation owner by cognitoSub when createdByMemberId is not a memberId", async () => {
    const doc = mockDoc({
      memberGetMiss: true,
      databaseCreatedByMemberId: "b4484dec-1001-70c5-ad14-dcac460b6510",
    });
    const upsertPageFn = vi.fn(async (args: { input: Record<string, unknown> }) => args.input);

    const result = await runTemplateAutomation({
      doc,
      tables,
      event: {
        type: "databaseTemplateAutomation",
        databaseId: "db-1",
        templateId: "template-1",
        automationId: "automation-1",
        scheduledTime: "2026-06-08T00:30:00.000Z",
      },
      now: () => new Date("2026-06-08T00:31:00.000Z"),
      upsertPageFn,
    });

    expect(result.status).toBe("succeeded");
    expect(upsertPageFn).toHaveBeenCalledTimes(1);
  });
});
