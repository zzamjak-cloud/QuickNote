// 페이지 웹 게시 핸들러 — 멱등 발행/권한/해제/상태 조회 검증.
import { describe, it, expect, vi } from "vitest";
import {
  publishPage,
  unpublishPage,
  getPagePublishStatus,
} from "./publishedPage";
import type { Member, Tables } from "./member";

const tables: Tables = {
  Members: "M",
  Teams: "T",
  MemberTeams: "MT",
  Workspaces: "W",
  WorkspaceAccess: "WA",
  Pages: "P",
  PublishedPages: "PP",
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

  it("이미 게시돼 있으면 기존 토큰 반환(멱등, Put 없음)", async () => {
    const existing = {
      token: "existing-token-1234567890",
      pageId: "page-1",
      workspaceId: "ws-1",
      publishedAt: "2026-07-01T00:00:00Z",
    };
    const doc = mockDoc({ Item: pageRow }, { Items: [existing] });
    const r = await publishPage({ doc, tables, caller: ownerCaller, pageId: "page-1" });
    expect(r.token).toBe("existing-token-1234567890");
    expect(vi.mocked(doc.send)).toHaveBeenCalledTimes(2);
  });

  it("삭제된 페이지는 게시 불가", async () => {
    const doc = mockDoc({ Item: { ...pageRow, deletedAt: "2026-07-01T00:00:00Z" } });
    await expect(
      publishPage({ doc, tables, caller: ownerCaller, pageId: "page-1" }),
    ).rejects.toThrow(/페이지 없음/);
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
