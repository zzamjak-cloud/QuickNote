import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { restoreDatabaseVersion } from "./pageDatabase";
import type { Member, Tables } from "./member";

const tables: Tables = {
  Members: "M",
  Teams: "T",
  MemberTeams: "MT",
  Workspaces: "W",
  WorkspaceAccess: "WA",
  Pages: "P",
  Databases: "D",
  DatabaseHistory: "DH",
};

const caller: Member = {
  memberId: "m1",
  email: "m1@example.com",
  name: "M1",
  jobRole: "Eng",
  workspaceRole: "member",
  status: "active",
  personalWorkspaceId: "ws-1",
  cognitoSub: "sub-1",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const historyEvent = {
  databaseId: "db-1",
  historyId: "history-1",
  workspaceId: "ws-1",
  snapshot: {
    id: "db-1",
    workspaceId: "ws-1",
    createdByMemberId: "m1",
    title: "복원 DB",
    columns: "[]",
    presets: "[]",
    templates: "[]",
    rowPageOrder: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  },
};

describe("restoreDatabaseVersion template LWW", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("현재 DB 시계가 앞서 있어도 두 LWW 버전보다 단조 증가한 복원 버전을 만든다", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-06-01T00:00:00.000Z"));
    const before = {
      id: "db-1",
      workspaceId: "ws-1",
      title: "현재 DB",
      updatedAt: "2030-01-01T00:00:00.000Z",
      templatesUpdatedAt: "2031-01-01T00:00:00.000Z",
    };
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [{ subjectType: "member", subjectId: "m1", level: "edit" }] })
      .mockResolvedValueOnce({ Items: [historyEvent] })
      .mockResolvedValueOnce({ Item: before })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});
    const doc = { send } as unknown as import("@aws-sdk/lib-dynamodb").DynamoDBDocumentClient;

    const result = await restoreDatabaseVersion({
      doc,
      tables,
      caller,
      input: { databaseId: "db-1", workspaceId: "ws-1", historyId: "history-1" },
    });

    expect(result.updatedAt).toBe("2031-01-01T00:00:00.001Z");
    expect(result.templatesUpdatedAt).toBe(result.updatedAt);
    const databasePut = send.mock.calls
      .map((call) => call[0])
      .find((command) => command instanceof PutCommand && command.input.TableName === "D") as
      | PutCommand
      | undefined;
    expect(databasePut?.input.ConditionExpression).toContain(
      "templatesUpdatedAt = :expectedTemplatesUpdatedAt",
    );
  });

  it("동시 편집으로 CAS가 실패하면 최신 버전을 다시 읽어 더 높은 복원 버전으로 재시도한다", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-06-01T00:00:00.000Z"));
    const initial = {
      id: "db-1",
      workspaceId: "ws-1",
      title: "초기 DB",
      updatedAt: "2026-06-02T00:00:00.000Z",
      templatesUpdatedAt: "2026-06-03T00:00:00.000Z",
    };
    const concurrent = {
      ...initial,
      title: "동시 편집 DB",
      updatedAt: "2032-01-01T00:00:00.000Z",
      templatesUpdatedAt: "2032-01-02T00:00:00.000Z",
    };
    const conditionalError = Object.assign(new Error("restore CAS failed"), {
      name: "ConditionalCheckFailedException",
    });
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [{ subjectType: "member", subjectId: "m1", level: "edit" }] })
      .mockResolvedValueOnce({ Items: [historyEvent] })
      .mockResolvedValueOnce({ Item: initial })
      .mockRejectedValueOnce(conditionalError)
      .mockResolvedValueOnce({ Item: concurrent })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});
    const doc = { send } as unknown as import("@aws-sdk/lib-dynamodb").DynamoDBDocumentClient;

    const result = await restoreDatabaseVersion({
      doc,
      tables,
      caller,
      input: { databaseId: "db-1", workspaceId: "ws-1", historyId: "history-1" },
    });

    expect(result.updatedAt).toBe("2032-01-02T00:00:00.001Z");
    expect(result.templatesUpdatedAt).toBe(result.updatedAt);
    const databasePuts = send.mock.calls
      .map((call) => call[0])
      .filter((command) => command instanceof PutCommand && command.input.TableName === "D") as PutCommand[];
    expect(databasePuts).toHaveLength(2);
    expect(databasePuts[1]?.input.ExpressionAttributeValues?.[":expectedTemplatesUpdatedAt"]).toBe(
      concurrent.templatesUpdatedAt,
    );
  });
});
