import { describe, expect, it, vi } from "vitest";
import { searchMembersForMention } from "./mention";
import type { Member, Tables } from "./member";

const tables: Tables = {
  Members: "M",
  Teams: "T",
  MemberTeams: "MT",
  Workspaces: "W",
  WorkspaceAccess: "WA",
};

const caller: Member = {
  memberId: "owner",
  email: "owner@x.com",
  name: "Owner",
  jobRole: "Lead",
  workspaceRole: "owner",
  status: "active",
  personalWorkspaceId: "ws-owner",
  cognitoSub: "sub-owner",
  createdAt: "2026-01-01T00:00:00Z",
};

function mockDoc(...returns: unknown[]) {
  const send = vi.fn();
  returns.forEach((r) => send.mockResolvedValueOnce(r));
  return { send } as unknown as import("@aws-sdk/lib-dynamodb").DynamoDBDocumentClient;
}

describe("searchMembersForMention", () => {
  it("active 멤버만 반환", async () => {
    const doc = mockDoc({
      Items: [
        { memberId: "m1", name: "Alice", jobRole: "Engineer", status: "active" },
        { memberId: "m2", name: "Bob", jobRole: "QA", status: "removed" },
      ],
    });
    const result = await searchMembersForMention({ doc, tables, caller, query: "", limit: 20 });
    expect(result).toHaveLength(1);
    expect(result[0].memberId).toBe("m1");
  });

  it("query 필터 + limit 적용", async () => {
    const doc = mockDoc({
      Items: [
        { memberId: "m1", name: "Alice Kim", jobRole: "Engineer", status: "active" },
        { memberId: "m2", name: "Alex Park", jobRole: "Engineer", status: "active" },
      ],
    });
    const result = await searchMembersForMention({ doc, tables, caller, query: "al", limit: 1 });
    expect(result).toHaveLength(1);
  });
});
