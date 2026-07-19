// 페이지 웹 게시 핸들러 — 멱등 발행/권한/해제/상태 조회 검증.
import { beforeEach, describe, it, expect, vi } from "vitest";
import {
  publishPage,
  unpublishPage,
  getPagePublishStatus,
} from "./publishedPage";
import type { Member, Tables } from "./member";

const s3SendMock = vi.hoisted(() => vi.fn());

vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  return {
    ...actual,
    S3Client: class {
      send(...args: unknown[]) {
        return s3SendMock(...args);
      }
    },
  };
});

const tables: Tables = {
  Members: "M",
  Teams: "T",
  MemberTeams: "MT",
  Workspaces: "W",
  WorkspaceAccess: "WA",
  Pages: "P",
  PublishedPages: "PP",
};

const snapshotTables: Tables = {
  ...tables,
  SharedBlocks: "SB",
  ImagesBucketName: "bucket",
};

const ownerCaller: Member = {
  memberId: "owner-1",
  email: "owner@x.com",
  name: "Owner",
  jobRole: "Lead",
  workspaceRole: "owner",
  status: "active",
  personalWorkspaceId: "ws-owner",
  cognitoSub: "owner-sub",
  createdAt: "2026-05-06T00:00:00Z",
};
// member 역할 — WorkspaceAccess 엔트리로 권한 결정
const memberCaller: Member = { ...ownerCaller, memberId: "m-1", workspaceRole: "member" };

function mockDoc(...returns: unknown[]) {
  const send = vi.fn();
  for (const r of returns) send.mockResolvedValueOnce(r);
  return { send } as unknown as import("@aws-sdk/lib-dynamodb").DynamoDBDocumentClient;
}

const pageRow = { id: "page-1", workspaceId: "ws-1" };

describe("publishPage", () => {
  beforeEach(() => {
    s3SendMock.mockReset();
  });

  it("정상 발행 — base64url 토큰 생성 + Put", async () => {
    const doc = mockDoc(
      { Item: pageRow }, // Pages GetItem
      { Items: [] }, // byPageId Query (active 없음)
      {}, // Put
    );
    const r = await publishPage({ doc, tables, caller: ownerCaller, pageId: "page-1" });
    expect(r.published).toBe(true);
    expect(r.token).toMatch(/^[A-Za-z0-9_-]{20,24}$/);
    expect(r.workspaceId).toBe("ws-1");
    expect(vi.mocked(doc.send)).toHaveBeenCalledTimes(3);
  });

  it("신규 게시 후 같은 token 아래 공개 스냅샷 version/key만 갱신한다", async () => {
    s3SendMock.mockResolvedValue({});
    const pageDoc = { type: "doc", content: [{ type: "paragraph" }] };
    const doc = mockDoc(
      { Item: { ...pageRow, title: "루트", doc: JSON.stringify(pageDoc) } }, // Pages GetItem
      { Items: [] }, // byPageId Query
      {}, // Put
      { Items: [{ id: "page-1", title: "루트", parentId: null, order: 0 }] }, // tree Query
      { Item: { ...pageRow, title: "루트", doc: JSON.stringify(pageDoc) } }, // page snapshot Get
      {}, // snapshot metadata Update
    );

    const r = await publishPage({
      doc,
      tables: snapshotTables,
      caller: ownerCaller,
      pageId: "page-1",
    });

    expect(r.published).toBe(true);
    expect(s3SendMock).toHaveBeenCalledTimes(2);
    const pagePut = s3SendMock.mock.calls[0]?.[0] as { input?: { Key?: string } };
    const sitePut = s3SendMock.mock.calls[1]?.[0] as { input?: { Key?: string } };
    expect(pagePut.input?.Key).toMatch(new RegExp(`^public-snapshots/${r.token}/.+/pages/page-1\\.json$`));
    expect(sitePut.input?.Key).toMatch(new RegExp(`^public-snapshots/${r.token}/.+/site\\.json$`));
    const updateCall = vi.mocked(doc.send).mock.calls[5]?.[0] as {
      input?: { UpdateExpression?: string; ExpressionAttributeValues?: Record<string, unknown> };
    };
    expect(updateCall.input?.UpdateExpression).toContain("snapshotVersion");
    expect(updateCall.input?.ExpressionAttributeValues?.[":p"]).toBe("page-1");
  });

  it("이미 게시돼 있으면 기존 토큰 유지 + 레이아웃 스냅샷 갱신(멱등, 새 토큰 없음)", async () => {
    const existing = {
      token: "existing-token-1234567890",
      pageId: "page-1",
      workspaceId: "ws-1",
      publishedAt: "2026-07-01T00:00:00Z",
    };
    const doc = mockDoc(
      { Item: pageRow }, // Pages GetItem
      { Items: [existing] }, // byPageId Query
      {}, // 레이아웃 스냅샷 UpdateItem
    );
    const caller: Member = {
      ...ownerCaller,
      clientPrefs: JSON.stringify({ fullWidth: false, pageFullWidthById: { "child-1": true } }),
    };
    const r = await publishPage({ doc, tables, caller, pageId: "page-1" });
    // 토큰은 그대로(공유 링크 유지)
    expect(r.token).toBe("existing-token-1234567890");
    // Get + Query + Update 3회 — 새 Put(새 토큰) 은 없어야 한다
    expect(vi.mocked(doc.send)).toHaveBeenCalledTimes(3);
    const updateCall = vi.mocked(doc.send).mock.calls[2][0] as {
      input: { UpdateExpression?: string; ExpressionAttributeValues?: Record<string, unknown> };
    };
    expect(updateCall.input.UpdateExpression).toContain("fullWidthById");
    expect(updateCall.input.ExpressionAttributeValues?.[":fw"]).toBe(false);
    expect(updateCall.input.ExpressionAttributeValues?.[":fwm"]).toEqual({
      "child-1": true,
      "page-1": false,
    });
  });

  it("layout 인자가 있으면 caller clientPrefs 대신 현재 클라이언트 레이아웃을 우선 반영한다", async () => {
    const existing = {
      token: "existing-token-1234567890",
      pageId: "page-1",
      workspaceId: "ws-1",
      publishedAt: "2026-07-01T00:00:00Z",
    };
    const doc = mockDoc(
      { Item: pageRow }, // Pages GetItem
      { Items: [existing] }, // byPageId Query
      {}, // 레이아웃 스냅샷 UpdateItem
    );
    const caller: Member = {
      ...ownerCaller,
      clientPrefs: JSON.stringify({
        fullWidth: false,
        pageFullWidthById: { "page-1": true },
      }),
    };

    await publishPage({
      doc,
      tables,
      caller,
      pageId: "page-1",
      layout: JSON.stringify({
        fullWidth: false,
        fullWidthDefault: true,
        fullWidthById: { "page-1": true, "child-1": true },
      }),
    });

    const updateCall = vi.mocked(doc.send).mock.calls[2][0] as {
      input: { ExpressionAttributeValues?: Record<string, unknown> };
    };
    expect(updateCall.input.ExpressionAttributeValues?.[":fw"]).toBe(false);
    expect(updateCall.input.ExpressionAttributeValues?.[":fwd"]).toBe(true);
    expect(updateCall.input.ExpressionAttributeValues?.[":fwm"]).toEqual({
      "page-1": false,
      "child-1": true,
    });
  });

  it("삭제된 페이지는 게시 불가", async () => {
    const doc = mockDoc({ Item: { ...pageRow, deletedAt: "2026-07-01T00:00:00Z" } });
    await expect(
      publishPage({ doc, tables, caller: ownerCaller, pageId: "page-1" }),
    ).rejects.toThrow(/페이지 없음/);
  });

  it("DB 행 페이지는 게시 불가(서빙 불가 유령 토큰 방지)", async () => {
    const doc = mockDoc({ Item: { ...pageRow, databaseId: "db-1" } });
    await expect(
      publishPage({ doc, tables, caller: ownerCaller, pageId: "page-1" }),
    ).rejects.toThrow(/데이터베이스 행/);
  });

  it("view 권한 멤버는 게시 거부", async () => {
    const doc = mockDoc(
      { Item: pageRow }, // Pages GetItem
      { Items: [] }, // MemberTeams
      { Items: [{ subjectType: "everyone", subjectId: null, level: "view" }] }, // WorkspaceAccess
    );
    await expect(
      publishPage({ doc, tables, caller: memberCaller, pageId: "page-1" }),
    ).rejects.toThrow(/edit 권한 필요/);
  });
});

describe("unpublishPage", () => {
  it("active 토큰 전부 revoke", async () => {
    const active = {
      token: "tok-1",
      pageId: "page-1",
      workspaceId: "ws-1",
      publishedAt: "2026-07-01T00:00:00Z",
    };
    const doc = mockDoc(
      { Items: [active] }, // byPageId Query
      { Item: pageRow }, // Pages GetItem
      {}, // Update revokedAt
    );
    const r = await unpublishPage({ doc, tables, caller: ownerCaller, pageId: "page-1" });
    expect(r.published).toBe(false);
    expect(r.token).toBeNull();
    const updateCall = vi.mocked(doc.send).mock.calls[2]?.[0] as {
      input?: { ConditionExpression?: string };
    };
    // 교차 페이지 변조 방지 조건 가드 확인
    expect(updateCall.input?.ConditionExpression).toContain("pageId");
  });

  it("페이지가 하드삭제돼도 게시 레코드 workspaceId 로 해제 가능", async () => {
    const active = {
      token: "tok-1",
      pageId: "page-1",
      workspaceId: "ws-1",
      publishedAt: "2026-07-01T00:00:00Z",
    };
    const doc = mockDoc(
      { Items: [active] },
      { Item: undefined }, // Pages GetItem miss
      {},
    );
    const r = await unpublishPage({ doc, tables, caller: ownerCaller, pageId: "page-1" });
    expect(r.published).toBe(false);
  });

  it("게시 정보도 페이지도 없으면 notFound", async () => {
    const doc = mockDoc({ Items: [] }, { Item: undefined });
    await expect(
      unpublishPage({ doc, tables, caller: ownerCaller, pageId: "page-x" }),
    ).rejects.toThrow(/게시 정보 없음/);
  });
});

describe("getPagePublishStatus", () => {
  it("게시 중이면 token 포함 상태 반환", async () => {
    const active = {
      token: "tok-1",
      pageId: "page-1",
      workspaceId: "ws-1",
      publishedAt: "2026-07-01T00:00:00Z",
    };
    const doc = mockDoc({ Item: pageRow }, { Items: [active] });
    const r = await getPagePublishStatus({ doc, tables, caller: ownerCaller, pageId: "page-1" });
    expect(r).toMatchObject({ published: true, token: "tok-1", workspaceId: "ws-1" });
  });

  it("미게시면 published=false", async () => {
    const doc = mockDoc({ Item: pageRow }, { Items: [] });
    const r = await getPagePublishStatus({ doc, tables, caller: ownerCaller, pageId: "page-1" });
    expect(r).toMatchObject({ published: false, token: null });
  });
});
