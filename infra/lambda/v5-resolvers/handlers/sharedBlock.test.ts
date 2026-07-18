import { describe, expect, it, vi } from "vitest";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { Member } from "./_auth";
import { getSharedBlock, upsertSharedBlock } from "./sharedBlock";
import type { Tables } from "./member";

const tables: Tables = {
  Members: "Members",
  Teams: "Teams",
  MemberTeams: "MemberTeams",
  Workspaces: "Workspaces",
  WorkspaceAccess: "WorkspaceAccess",
  SharedBlocks: "SharedBlocks",
  ImageAssets: "ImageAssets",
  AssetUsage: "AssetUsage",
};

const developer: Member = {
  memberId: "member-1",
  email: "dev@example.com",
  name: "개발자",
  jobRole: "개발",
  workspaceRole: "developer",
  status: "active",
  personalWorkspaceId: "ws-personal",
  cognitoSub: "sub-1",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function makeDoc(send: ReturnType<typeof vi.fn>): DynamoDBDocumentClient {
  return { send } as unknown as DynamoDBDocumentClient;
}

function input(updatedAt = "2026-07-18T01:00:00.000Z") {
  return {
    id: "shared-1",
    workspaceId: "ws-1",
    kind: "dropdown-menu",
    data: {
      kind: "dropdown-menu",
      items: [{ id: "ko", label: "한국어", pageId: "page-ko" }],
    },
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt,
  };
}

describe("sharedBlock resolver", () => {
  it("get 은 view 권한 뒤 workspaceId 가 일치하는 row 만 반환한다", async () => {
    const send = vi.fn().mockResolvedValueOnce({
      Item: { ...input(), workspaceId: "ws-other" },
    });
    const result = await getSharedBlock({
      doc: makeDoc(send),
      tables,
      caller: developer,
      id: "shared-1",
      workspaceId: "ws-1",
    });
    expect(result).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("upsert 은 kind/data 를 검증·정규화하고 원자 LWW 조건으로 저장한다", async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({});
    const result = await upsertSharedBlock({
      doc: makeDoc(send),
      tables,
      caller: developer,
      input: input(),
    });
    expect(result).toMatchObject({
      id: "shared-1",
      workspaceId: "ws-1",
      kind: "dropdown-menu",
      createdAt: "2026-07-18T00:00:00.000Z",
      updatedAt: "2026-07-18T01:00:00.000Z",
      deletedAt: null,
    });
    expect(typeof result.data).toBe("string");
    const putInput = (send.mock.calls[1]?.[0] as { input?: Record<string, unknown> }).input;
    expect(putInput?.ConditionExpression).toContain("#updatedAt < :updatedAt");
  });

  it("더 오래됐거나 같은 updatedAt 은 기존 row 를 그대로 반환한다", async () => {
    const existing = {
      ...input("2026-07-18T02:00:00.000Z"),
      data: JSON.stringify({ kind: "dropdown-menu", items: [] }),
      deletedAt: null,
    };
    const send = vi.fn().mockResolvedValueOnce({ Item: existing });
    const result = await upsertSharedBlock({
      doc: makeDoc(send),
      tables,
      caller: developer,
      input: input("2026-07-18T01:00:00.000Z"),
    });
    expect(result).toBe(existing);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("동시 쓰기 조건 실패 시 다시 읽은 최신 승자를 반환한다", async () => {
    const winner = {
      ...input("2026-07-18T03:00:00.000Z"),
      data: JSON.stringify({ kind: "dropdown-menu", items: [] }),
      deletedAt: null,
    };
    const conflict = Object.assign(new Error("conflict"), {
      name: "ConditionalCheckFailedException",
    });
    const send = vi.fn()
      .mockResolvedValueOnce({ Item: undefined })
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({ Item: winner });
    const result = await upsertSharedBlock({
      doc: makeDoc(send),
      tables,
      caller: developer,
      input: input(),
    });
    expect(result).toBe(winner);
  });

  it("갤러리 최신 자산은 페이지 수명과 분리된 합성 AssetUsage로 교체한다", async () => {
    const galleryInput = {
      ...input(),
      kind: "gallery",
      data: {
        kind: "gallery",
        images: [{ id: "image-1", src: "quicknote-image://asset-new", alt: "상품" }],
        intervalMs: 5_000,
      },
    };
    const saved = {
      ...galleryInput,
      data: JSON.stringify(galleryInput.data),
      deletedAt: null,
      usageTrackedAssetIds: new Set(["asset-new"]),
    };
    const send = vi.fn()
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({ Responses: { ImageAssets: [{ id: "asset-new", ownerId: "sub-1" }] } })
      .mockResolvedValueOnce({ Attributes: saved })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    await upsertSharedBlock({
      doc: makeDoc(send),
      tables,
      caller: developer,
      input: galleryInput,
    });

    const transaction = (send.mock.calls[3]?.[0] as {
      input?: { TransactItems?: Array<Record<string, unknown>> };
    }).input?.TransactItems ?? [];
    expect(transaction[0]).toMatchObject({
      ConditionCheck: {
        TableName: "SharedBlocks",
        Key: { id: "shared-1" },
      },
    });
    expect(transaction[1]).toMatchObject({
      Put: {
        TableName: "AssetUsage",
        Item: {
          assetId: "asset-new",
          sk: "SHARED_BLOCK#ws-1#shared-1",
          pageId: "__sharedBlock__:ws-1:shared-1",
          blockType: "sharedGallery",
          workspaceId: "ws-1",
          sharedBlockId: "shared-1",
        },
      },
    });
    expect(JSON.stringify(transaction[1])).not.toContain("PAGE#");
  });

  it("갤러리를 드롭다운으로 바꾸면 기존 합성 AssetUsage를 삭제한다", async () => {
    const existing = {
      id: "shared-1",
      workspaceId: "ws-1",
      kind: "gallery",
      data: JSON.stringify({
        kind: "gallery",
        images: [{ id: "image-old", src: "quicknote-image://asset-old", alt: "이전" }],
        intervalMs: 5_000,
      }),
      createdAt: "2026-07-18T00:00:00.000Z",
      updatedAt: "2026-07-18T00:30:00.000Z",
      deletedAt: null,
      usageTrackedAssetIds: new Set(["asset-old"]),
    };
    const saved = {
      ...input(),
      data: JSON.stringify(input().data),
      deletedAt: null,
      usageTrackedAssetIds: new Set(["asset-old"]),
    };
    const send = vi.fn()
      .mockResolvedValueOnce({ Item: existing })
      .mockResolvedValueOnce({ Attributes: saved })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    await upsertSharedBlock({
      doc: makeDoc(send),
      tables,
      caller: developer,
      input: input(),
    });

    const transaction = (send.mock.calls[2]?.[0] as {
      input?: { TransactItems?: Array<Record<string, unknown>> };
    }).input?.TransactItems ?? [];
    expect(transaction[1]).toEqual({
      Delete: {
        TableName: "AssetUsage",
        Key: { assetId: "asset-old", sk: "SHARED_BLOCK#ws-1#shared-1" },
      },
    });
    const cleanup = (send.mock.calls[3]?.[0] as { input?: { UpdateExpression?: string } }).input;
    expect(cleanup?.UpdateExpression).toContain("REMOVE #usageTrackedAssetIds");
  });

  it("일반 멤버에게 edit 접근 엔트리가 없으면 저장을 거부한다", async () => {
    const member = { ...developer, workspaceRole: "member" as const };
    const send = vi.fn()
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] });
    await expect(upsertSharedBlock({
      doc: makeDoc(send),
      tables,
      caller: member,
      input: input(),
    })).rejects.toMatchObject({ errorType: "Forbidden" });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("kind 와 data.kind 불일치는 저장 전에 거부한다", async () => {
    const send = vi.fn();
    await expect(upsertSharedBlock({
      doc: makeDoc(send),
      tables,
      caller: developer,
      input: { ...input(), kind: "gallery" },
    })).rejects.toMatchObject({ errorType: "BadRequest" });
    expect(send).not.toHaveBeenCalled();
  });
});
