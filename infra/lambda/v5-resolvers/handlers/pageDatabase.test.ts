import { describe, expect, it, vi } from "vitest";
import {
  listDatabases,
  listPages,
  listTrashedPages,
  restorePage,
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

  it("upsertPage: coverImage 가 너무 크면 거부", async () => {
    const doc = mockDoc(
      { Items: [] },
      { Items: [{ subjectType: "member", subjectId: "m1", level: "edit" }] },
    );
    await expect(
      upsertPage({
        doc,
        tables,
        caller,
        input: {
          id: "p1",
          workspaceId: "ws-1",
          updatedAt: "now",
          createdAt: "now",
          title: "T",
          doc: "{}",
          order: "a",
          createdByMemberId: "m1",
          coverImage: "x".repeat(350_001),
        },
      }),
    ).rejects.toThrow(/너무 큽|큽니다/);
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

  it("listTrashedPages: 삭제된 페이지만 반환", async () => {
    const recent = new Date().toISOString();
    const doc = mockDoc(
      { Items: [] },
      { Items: [{ subjectType: "everyone", subjectId: null, level: "view" }] },
      {
        Items: [
          {
            id: "p-trash",
            workspaceId: "ws-1",
            deletedAt: recent,
            updatedAt: recent,
            title: "T",
          },
        ],
      },
    );
    const result = await listTrashedPages({ doc, tables, caller, workspaceId: "ws-1" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.id).toBe("p-trash");
  });

  it("restorePage: 삭제 항목이면 복원", async () => {
    const doc = mockDoc(
      { Items: [] },
      { Items: [{ subjectType: "member", subjectId: "m1", level: "edit" }] },
      {
        Item: {
          id: "p1",
          workspaceId: "ws-1",
          deletedAt: new Date(Date.now() - 864e5).toISOString(),
          title: "Hi",
          doc: "{}",
          order: "0",
          createdByMemberId: "m1",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      },
      {},
    );
    const result = await restorePage({
      doc,
      tables,
      caller,
      id: "p1",
      workspaceId: "ws-1",
    });
    expect(result["id"]).toBe("p1");
    expect(result["deletedAt"]).toBeUndefined();
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
