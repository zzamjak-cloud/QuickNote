// MCP 테스트 공용 픽스처 — 테이블명·멤버·컨텍스트.
import type { Member } from "../../v5-resolvers/handlers/_auth";
import type { McpTokenRecord } from "../../_shared/mcpToken";
import type { McpContext, McpTables } from "../context";
import { createFakeDdb, type Item } from "./fakeDdb";

export const TABLES: McpTables = {
  Members: "members",
  Teams: "teams",
  MemberTeams: "member-teams",
  Workspaces: "workspaces",
  WorkspaceAccess: "workspace-access",
  Pages: "pages",
  Databases: "databases",
  Comments: "comments",
  McpTokens: "mcp-tokens",
  RateLimit: "ai-usage",
  PageHistory: "page-history",
  AssetUsage: "asset-usage",
  ImageAssets: "image-assets",
  Schedules: "schedules",
  DatabaseRowMembers: "db-row-members",
  Notifications: "notifications",
};

export function member(overrides: Partial<Member> = {}): Member {
  return {
    memberId: "m1",
    email: "m1@example.com",
    name: "Alice",
    jobRole: "dev",
    workspaceRole: "member",
    status: "active",
    personalWorkspaceId: "ws-personal-m1",
    cognitoSub: "sub-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function tokenRecord(overrides: Partial<McpTokenRecord> = {}): McpTokenRecord {
  return {
    tokenHash: "hash",
    tokenId: "tok-1",
    memberId: "m1",
    name: "test",
    scopes: ["read"],
    workspaceIds: [],
    tokenHint: "abcd",
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: null,
    lastUsedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

/** 멤버 m1 이 ws-a(edit)·ws-b(view) 에 접근 가능, ws-c 는 접근 불가인 기본 데이터. */
export function baseTables(): Record<string, Item[]> {
  return {
    members: [member() as unknown as Item, member({ memberId: "m2", name: "Bob", email: "bob@example.com" }) as unknown as Item],
    "member-teams": [],
    workspaces: [
      { workspaceId: "ws-a", name: "Alpha", type: "shared", ownerMemberId: "m9", createdAt: "x" },
      { workspaceId: "ws-b", name: "Beta", type: "shared", ownerMemberId: "m9", createdAt: "x" },
      { workspaceId: "ws-c", name: "Gamma", type: "shared", ownerMemberId: "m9", createdAt: "x" },
    ],
    "workspace-access": [
      { workspaceId: "ws-a", subjectKey: "member#m1", subjectType: "member", subjectId: "m1", level: "edit" },
      { workspaceId: "ws-b", subjectKey: "member#m1", subjectType: "member", subjectId: "m1", level: "view" },
      { workspaceId: "ws-c", subjectKey: "member#m2", subjectType: "member", subjectId: "m2", level: "edit" },
    ],
    pages: [],
    databases: [],
    comments: [],
    "mcp-tokens": [],
    "ai-usage": [],
  };
}

export function makeCtx(tables: Record<string, Item[]> = baseTables(), token: Partial<McpTokenRecord> = {}) {
  const fake = createFakeDdb(tables);
  const ctx: McpContext = {
    doc: fake.doc,
    tables: TABLES,
    caller: member(),
    token: tokenRecord(token),
    collabRoomEpoch: "v5",
  };
  return { ctx, fake };
}
