import { describe, expect, it, vi } from "vitest";
import {
  listDatabases,
  listPages,
  softDeleteDatabase,
  softDeletePage,
  upsertDatabase,
  upsertPage,
} from "./pageDatabase";
import type { Member, Tables } from "./member";

const tables: Tables = {
  Members: "M",
  Teams: "T",
  MemberTeams: "MT",
  Workspaces: "W",
  WorkspaceAccess: "WA",
  Pages: "P",
  Databases: "D",
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

function mockDoc(...returns: unknown[]) {
  const send = vi.fn();
  returns.forEach((r) => send.mockResolvedValueOnce(r));
  return { send } as unknown as import("@aws-sdk/lib-dynamodb").DynamoDBDocumentClient;
}

describe("page/database handlers", () => {
  it("listPages: view 권한 없으면 실패", async () => {
    const doc = mockDoc(
      { Items: [] }, // memberTeams
      { Items: [] }, // workspaceAccess
    );
    await expect(
      listPages({ doc, tables, caller, workspaceId: "ws-x" }),
    ).rejects.toThrow(/권한|접근/);
  });

  it("upsertPage: edit 권한이면 성공", async () => {
    const doc = mockDoc(
      { Items: [] }, // memberTeams
      { Items: [{ subjectType: "member", subjectId: "m1", level: "edit" }] }, // workspaceAccess
      {}, // put
    );
    const result = await upsertPage({
      doc,
      tables,
      caller,
      input: { id: "p1", workspaceId: "ws-1", updatedAt: "now", createdAt: "now", title: "T", doc: "{}", order: "a", createdByMemberId: "m1" },
    });
    expect(result.id).toBe("p1");
  });

  it("softDeletePage: edit 권한이면 성공", async () => {
    const doc = mockDoc(
      { Items: [] }, // memberTeams
      { Items: [{ subjectType: "member", subjectId: "m1", level: "edit" }] }, // workspaceAccess
      { Item: { id: "p1", workspaceId: "ws-1" } }, // get
      { Attributes: { id: "p1", deletedAt: "now" } }, // update
    );
    const result = await softDeletePage({
      doc,
      tables,
      caller,
      id: "p1",
      workspaceId: "ws-1",
      updatedAt: "old",
    });
    expect(result.id).toBe("p1");
  });

  it("listDatabases: view 권한이면 조회", async () => {
    const doc = mockDoc(
      { Items: [] }, // memberTeams
      { Items: [{ subjectType: "everyone", subjectId: null, level: "view" }] }, // workspaceAccess
      { Items: [{ id: "d1" }] }, // query
    );
    const result = await listDatabases({ doc, tables, caller, workspaceId: "ws-1" });
    expect(result.items).toHaveLength(1);
  });

  it("upsertDatabase: edit 권한 없음 실패", async () => {
    const doc = mockDoc(
      { Items: [] }, // memberTeams
      { Items: [{ subjectType: "everyone", subjectId: null, level: "view" }] }, // workspaceAccess
    );
    await expect(
      upsertDatabase({
        doc,
        tables,
        caller,
        input: { id: "d1", workspaceId: "ws-1", updatedAt: "now", createdAt: "now", title: "D", columns: "{}", createdByMemberId: "m1" },
      }),
    ).rejects.toThrow(/권한/);
  });

  it("softDeleteDatabase: 대상 없으면 실패", async () => {
    const doc = mockDoc(
      { Items: [] }, // memberTeams
      { Items: [{ subjectType: "member", subjectId: "m1", level: "edit" }] }, // workspaceAccess
      {}, // get 없음
    );
    await expect(
      softDeleteDatabase({
        doc,
        tables,
        caller,
        id: "d-no",
        workspaceId: "ws-1",
        updatedAt: "old",
      }),
    ).rejects.toThrow(/없음/);
  });
});
