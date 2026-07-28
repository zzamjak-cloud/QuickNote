// 웹 게시 방문자 대시보드 집계 — developer 가드·집계 정확성 검증.
import { describe, expect, it, vi } from "vitest";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { getPublishAnalytics } from "./publishAnalytics";
import type { Member } from "./_auth";
import type { Tables } from "./member";

const tables = {
  Members: "M",
  MemberTeams: "MT",
  Teams: "T",
  Workspaces: "W",
  WorkspaceAccess: "WA",
  PublishedPages: "PP",
  PublishAnalytics: "PA",
} as Tables;

function member(workspaceRole: Member["workspaceRole"]): Member {
  return {
    memberId: "m-1",
    email: "dev@example.com",
    name: "개발자",
    workspaceRole,
    status: "active",
  } as Member;
}

function docWith(responses: unknown[]): DynamoDBDocumentClient {
  const send = vi.fn();
  for (const r of responses) send.mockResolvedValueOnce(r);
  return { send } as unknown as DynamoDBDocumentClient;
}

describe("getPublishAnalytics", () => {
  it("developer 가 아니면 Forbidden", async () => {
    await expect(
      getPublishAnalytics({
        doc: docWith([]),
        tables,
        caller: member("owner"),
        pageId: "page-1",
      }),
    ).rejects.toThrow("developer 만 가능");
  });

  it("active 게시가 없으면 published:false 빈 집계를 반환한다", async () => {
    const result = await getPublishAnalytics({
      doc: docWith([{ Items: [] }]),
      tables,
      caller: member("developer"),
      pageId: "page-1",
    });
    expect(result.published).toBe(false);
    expect(result.totalViews).toBe(0);
    expect(result.uniqueVisitors).toBe(0);
  });

  it("visitor/day/page 행을 조회수·방문자·국가별로 집계한다", async () => {
    const doc = docWith([
      // getActivePublishRecords — byPageId Query
      {
        Items: [
          { token: "tok-1", pageId: "page-1", publishedAt: "2026-07-01T00:00:00Z" },
        ],
      },
      // analytics Query (단일 페이지네이션)
      {
        Items: [
          {
            token: "tok-1",
            sk: "visitor#aaa",
            views: 3,
            country: "KR",
            firstSeenAt: "2026-07-20T00:00:00Z",
            lastSeenAt: "2026-07-28T09:00:00Z",
          },
          {
            token: "tok-1",
            sk: "visitor#bbb",
            views: 2,
            country: "KR",
            firstSeenAt: "2026-07-25T00:00:00Z",
            lastSeenAt: "2026-07-26T00:00:00Z",
          },
          {
            token: "tok-1",
            sk: "visitor#ccc",
            views: 1,
            country: "US",
            firstSeenAt: "2026-07-27T00:00:00Z",
            lastSeenAt: "2026-07-27T00:00:00Z",
          },
          { token: "tok-1", sk: "day#2026-07-27", views: 4 },
          { token: "tok-1", sk: "day#2026-07-28", views: 2 },
          { token: "tok-1", sk: "page#root-1", views: 5 },
          { token: "tok-1", sk: "page#child-1", views: 1 },
        ],
      },
    ]);

    const result = await getPublishAnalytics({
      doc,
      tables,
      caller: member("developer"),
      pageId: "page-1",
    });

    expect(result.published).toBe(true);
    expect(result.totalViews).toBe(6); // visitor views 합
    expect(result.uniqueVisitors).toBe(3); // 동일 IP(해시) = 1명
    expect(result.firstViewAt).toBe("2026-07-20T00:00:00Z");
    expect(result.lastViewAt).toBe("2026-07-28T09:00:00Z");
    expect(result.countries).toEqual([
      { country: "KR", visitors: 2, views: 5 },
      { country: "US", visitors: 1, views: 1 },
    ]);
    expect(result.daily).toEqual([
      { date: "2026-07-27", views: 4 },
      { date: "2026-07-28", views: 2 },
    ]);
    expect(result.pages[0]).toEqual({ pageId: "root-1", views: 5 });
  });

  it("revoke 된 토큰은 집계에서 제외한다", async () => {
    const doc = docWith([
      {
        Items: [
          {
            token: "tok-old",
            pageId: "page-1",
            publishedAt: "2026-06-01T00:00:00Z",
            revokedAt: "2026-06-10T00:00:00Z",
          },
        ],
      },
    ]);
    const result = await getPublishAnalytics({
      doc,
      tables,
      caller: member("developer"),
      pageId: "page-1",
    });
    expect(result.published).toBe(false);
  });
});
