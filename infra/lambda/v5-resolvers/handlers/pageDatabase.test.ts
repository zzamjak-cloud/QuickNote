import { describe, expect, it, vi } from "vitest";
import {
  emptyTrash,
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
      { Item: undefined }, // blockComments 보존용 Get — 기존 페이지 없음
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

  it("upsertPage: blockComments 가 객체여도 문자열로 정규화되어 성공(AppSync AWSJSON 파싱 경로)", async () => {
    const doc = mockDoc(
      { Item: undefined },
      { Items: [] },
      { Items: [{ subjectType: "member", subjectId: "m1", level: "edit" }] },
      {}, // put
    );
    const input: Record<string, unknown> = {
      id: "p1",
      workspaceId: "ws-1",
      updatedAt: "now",
      createdAt: "now",
      title: "T",
      doc: "{}",
      order: "a",
      createdByMemberId: "m1",
      blockComments: { messages: [], threadVisitedAt: {} },
    };
    const result = await upsertPage({ doc, tables, caller, input });
    expect(result.id).toBe("p1");
    expect(typeof result.blockComments).toBe("string");
    expect(JSON.parse(result.blockComments as string)).toEqual({ messages: [], threadVisitedAt: {} });
  });

  it("upsertPage: blockComments 키가 없으면 Dynamo 기존 값을 이어 붙인다", async () => {
    const existingBc = JSON.stringify({
      messages: [
        {
          id: "c1",
          pageId: "p1",
          blockId: "b1",
          authorMemberId: "m2",
          bodyText: "유지",
          mentionMemberIds: [],
          parentId: null,
          createdAt: 1,
        },
      ],
      threadVisitedAt: {},
    });
    const doc = mockDoc(
      { Item: { id: "p1", blockComments: existingBc } },
      { Items: [] },
      { Items: [{ subjectType: "member", subjectId: "m1", level: "edit" }] },
      {},
    );
    const result = await upsertPage({
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
      },
    });
    expect(typeof result.blockComments).toBe("string");
    expect(JSON.parse(result.blockComments as string).messages).toHaveLength(1);
    expect(JSON.parse(result.blockComments as string).messages[0].bodyText).toBe("유지");
  });

  it("upsertPage: coverImage 가 너무 크면 거부", async () => {
    const doc = mockDoc(
      { Item: undefined }, // blockComments 키 없을 때 선행 Get
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

  it("upsertDatabase: advanced column config AWSJSON 문자열을 그대로 보존한다", async () => {
    const columns = JSON.stringify([
      {
        id: "status",
        name: "상태",
        type: "select",
        config: {
          sourceFromDb: {
            databaseId: "source-db",
            columnId: "source-status",
            automation: true,
            viaPageLinkColumnId: "feature-link",
          },
        },
      },
      {
        id: "feature",
        name: "기능",
        type: "itemFetch",
        config: {
          itemFetchSourceDatabaseId: "feature-db",
          itemFetchMatchColumnId: "task-link",
        },
      },
      {
        id: "qa-period",
        name: "QA 기간",
        type: "date",
        config: {
          timelineCard: {
            enabled: true,
            titleMode: "custom",
            title: "QA 일정",
            color: "#2563EB",
          },
        },
      },
    ]);
    const doc = mockDoc(
      { Items: [] }, // memberTeams
      { Items: [{ subjectType: "member", subjectId: "m1", level: "edit" }] }, // workspaceAccess
      { Item: undefined }, // 기존 DB 조회 — 없음
      {}, // put
    );

    const result = await upsertDatabase({
      doc,
      tables,
      caller,
      input: {
        id: "d1",
        workspaceId: "ws-1",
        updatedAt: "now",
        createdAt: "now",
        title: "D",
        columns,
        createdByMemberId: "m1",
      },
    });

    expect(result.columns).toBe(columns);
    const sendMock = doc.send as unknown as ReturnType<typeof vi.fn>;
    const putCommand = sendMock.mock.calls.at(-1)?.[0] as { input?: { Item?: Record<string, unknown> } };
    expect(putCommand.input?.Item?.columns).toBe(columns);
    expect(putCommand.input?.Item?.columns).toContain('"automation":true');
    expect(putCommand.input?.Item?.columns).toContain('"itemFetchSourceDatabaseId":"feature-db"');
    expect(putCommand.input?.Item?.columns).toContain('"timelineCard"');
    expect(putCommand.input?.Item?.columns).toContain('"title":"QA 일정"');
  });

  it("upsertDatabase: advanced column config AWSJSON 배열을 문자열로 정규화한다", async () => {
    const columns = [
      {
        id: "status",
        name: "상태",
        type: "select",
        config: {
          sourceFromDb: {
            databaseId: "source-db",
            columnId: "source-status",
            automation: true,
            viaPageLinkColumnId: "feature-link",
          },
        },
      },
      {
        id: "feature",
        name: "기능",
        type: "itemFetch",
        config: {
          itemFetchSourceDatabaseId: "feature-db",
          itemFetchMatchColumnId: "task-link",
        },
      },
      {
        id: "qa-period",
        name: "QA 기간",
        type: "date",
        config: {
          timelineCard: {
            enabled: true,
            titleMode: "custom",
            title: "QA 일정",
            color: "#2563EB",
          },
        },
      },
    ];
    const presets = [
      {
        id: "preset-1",
        databaseId: "d1",
        name: "Feature",
        scope: "project",
        columnDefaults: { status: "todo" },
        requiredColumnIds: ["status"],
        visibleColumnIds: ["status", "feature"],
        hiddenColumnIds: [],
        schedulerDefaults: { titlePrefix: "[Feature]" },
        createdAt: 1,
        updatedAt: 2,
      },
    ];
    const doc = mockDoc(
      { Items: [] }, // memberTeams
      { Items: [{ subjectType: "member", subjectId: "m1", level: "edit" }] }, // workspaceAccess
      { Item: undefined }, // 기존 DB 조회 — 없음
      {}, // put
    );

    const result = await upsertDatabase({
      doc,
      tables,
      caller,
      input: {
        id: "d1",
        workspaceId: "ws-1",
        updatedAt: "now",
        createdAt: "now",
        title: "D",
        columns,
        presets,
        createdByMemberId: "m1",
      },
    });

    expect(typeof result.columns).toBe("string");
    expect(typeof result.presets).toBe("string");
    expect(JSON.parse(result.columns as string)).toEqual(columns);
    expect(JSON.parse(result.presets as string)).toEqual(presets);
    const sendMock = doc.send as unknown as ReturnType<typeof vi.fn>;
    const putCommand = sendMock.mock.calls.at(-1)?.[0] as { input?: { Item?: Record<string, unknown> } };
    expect(typeof putCommand.input?.Item?.columns).toBe("string");
    expect(typeof putCommand.input?.Item?.presets).toBe("string");
    expect(putCommand.input?.Item?.columns).toContain('"automation":true');
    expect(putCommand.input?.Item?.columns).toContain('"itemFetchSourceDatabaseId":"feature-db"');
    expect(putCommand.input?.Item?.columns).toContain('"timelineCard"');
    expect(putCommand.input?.Item?.columns).toContain('"title":"QA 일정"');
  });

  it("upsertDatabase: LWW — 더 오래된 updatedAt 은 서버 최신값을 덮지 않는다", async () => {
    const existingItem = {
      id: "d1",
      workspaceId: "ws-1",
      title: "D",
      columns: "[]",
      panelState: JSON.stringify({ viewConfigs: { timeline: { hiddenColumnIds: ["c1"] } } }),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-06-02T00:00:00.000Z", // 서버가 더 최신
      createdByMemberId: "m1",
    };
    const doc = mockDoc(
      { Items: [] }, // memberTeams
      { Items: [{ subjectType: "member", subjectId: "m1", level: "edit" }] }, // workspaceAccess
      { Item: existingItem }, // 기존 DB 조회 — 더 최신
    );

    const result = await upsertDatabase({
      doc,
      tables,
      caller,
      input: {
        id: "d1",
        workspaceId: "ws-1",
        updatedAt: "2026-06-01T00:00:00.000Z", // 더 오래됨 → 무시되어야 함
        createdAt: "2026-01-01T00:00:00.000Z",
        title: "STALE",
        columns: "[]",
        createdByMemberId: "m1",
      },
    });

    // stale write 는 폐기되고 기존값이 반환된다(쓰기 send 가 호출되지 않음).
    expect(result).toEqual(existingItem);
    const sendMock = doc.send as unknown as ReturnType<typeof vi.fn>;
    expect(sendMock.mock.calls).toHaveLength(3); // memberTeams, workspaceAccess, get (put 없음)
  });

  it("upsertDatabase: 부분 payload 는 기존 panelState 를 지우지 않고 병합한다", async () => {
    const existingPanelState = JSON.stringify({ viewConfigs: { timeline: { hiddenColumnIds: ["c1"] } } });
    const existingItem = {
      id: "d1",
      workspaceId: "ws-1",
      title: "D",
      columns: "[]",
      panelState: existingPanelState,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
      createdByMemberId: "m1",
    };
    const doc = mockDoc(
      { Items: [] }, // memberTeams
      { Items: [{ subjectType: "member", subjectId: "m1", level: "edit" }] }, // workspaceAccess
      { Item: existingItem }, // 기존 DB 조회
      {}, // put
    );

    // panelState 를 생략한(시드/컬럼편집) 더 최신 payload.
    const result = await upsertDatabase({
      doc,
      tables,
      caller,
      input: {
        id: "d1",
        workspaceId: "ws-1",
        updatedAt: "2026-06-02T00:00:00.000Z", // 더 최신 → 수락
        createdAt: "2026-01-01T00:00:00.000Z",
        title: "D2",
        columns: "[]",
        createdByMemberId: "m1",
      },
    });

    // 기존 panelState 보존 + 신규 title 반영.
    expect(result.panelState).toBe(existingPanelState);
    expect(result.title).toBe("D2");
    const sendMock = doc.send as unknown as ReturnType<typeof vi.fn>;
    const putCommand = sendMock.mock.calls.at(-1)?.[0] as { input?: { Item?: Record<string, unknown> } };
    expect(putCommand.input?.Item?.panelState).toBe(existingPanelState);
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

  it("emptyTrash: 삭제된 페이지를 DynamoDB에서 영구 삭제", async () => {
    const doc = mockDoc(
      { Items: [] },
      { Items: [{ subjectType: "member", subjectId: "m1", level: "edit" }] },
      { Items: [{ id: "p1" }, { id: "p2" }] },
      {},
      {},
    );
    const result = await emptyTrash({ doc, tables, caller, workspaceId: "ws-1" });
    expect(result).toBe(2);
    expect((doc.send as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(5);
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
