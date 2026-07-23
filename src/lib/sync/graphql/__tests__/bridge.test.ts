import { beforeEach, describe, expect, it, vi } from "vitest";
import { realGqlBridge } from "../bridge";

const mocks = vi.hoisted(() => ({
  graphql: vi.fn(async () => ({})),
}));

vi.mock("../client", () => ({
  appsyncClient: () => ({ graphql: mocks.graphql }),
}));

describe("realGqlBridge.upsertPage", () => {
  beforeEach(() => {
    mocks.graphql.mockClear();
  });

  it("meta-only page upsert는 작은 응답 selection과 정규화 input을 사용한다", async () => {
    await realGqlBridge.upsertPage({
      __metaOnly: true,
      id: "page-1",
      workspaceId: "ws-1",
      createdByMemberId: "member-1",
      title: "Moved",
      icon: null,
      parentId: null,
      order: "1",
      fullPageDatabaseId: "db-home",
      doc: { type: "doc", content: [{ type: "paragraph" }] },
      createdAt: "2026-06-15T00:00:00.000Z",
      updatedAt: "2026-06-15T00:00:01.000Z",
    });

    expect(mocks.graphql).toHaveBeenCalledTimes(1);
    const args = mocks.graphql.mock.calls[0]?.[0];
    expect(args.query).toContain("mutation UpsertPageMeta");
    expect(args.query).not.toContain("doc dbCells blockComments");
    expect(args.variables.input).not.toHaveProperty("__metaOnly");
    expect(args.variables.input.fullPageDatabaseId).toBe("db-home");
    expect(args.variables.input.doc).toBe(JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph" }],
    }));
  });
});

describe("realGqlBridge.toggleCommentReaction", () => {
  beforeEach(() => {
    mocks.graphql.mockClear();
  });

  it("댓글 반응 토글 mutation과 input을 전달한다", async () => {
    await realGqlBridge.toggleCommentReaction({
      id: "c-1",
      workspaceId: "ws-1",
      reactionKind: "emoji",
      reactionValue: "✅",
      reacted: true,
      updatedAt: "2026-07-23T00:00:00.000Z",
    });

    expect(mocks.graphql).toHaveBeenCalledTimes(1);
    const args = mocks.graphql.mock.calls[0]?.[0];
    expect(args.query).toContain("mutation ToggleCommentReaction");
    expect(args.variables.input).toMatchObject({
      id: "c-1",
      workspaceId: "ws-1",
      reactionKind: "emoji",
      reactionValue: "✅",
      reacted: true,
    });
  });
});
