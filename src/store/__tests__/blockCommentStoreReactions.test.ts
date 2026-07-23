import { beforeEach, describe, expect, it, vi } from "vitest";

const { enqueueAsync } = vi.hoisted(() => ({
  enqueueAsync: vi.fn(),
}));

vi.mock("../../lib/sync/runtime", () => ({ enqueueAsync }));

import { useBlockCommentStore } from "../blockCommentStore";
import { useWorkspaceStore } from "../workspaceStore";

describe("blockCommentStore 댓글 반응", () => {
  beforeEach(() => {
    enqueueAsync.mockClear();
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-1" });
    useBlockCommentStore.setState({
      messages: [
        {
          id: "c-1",
          workspaceId: "ws-1",
          pageId: "p-1",
          blockId: "b-1",
          authorMemberId: "m-author",
          bodyText: "댓글",
          mentionMemberIds: [],
          parentId: null,
          createdAt: 1,
        },
      ],
    });
  });

  it("같은 멤버의 이모지 반응을 추가하고 다시 해제한다", () => {
    const store = useBlockCommentStore.getState();

    expect(store.toggleReaction("c-1", { kind: "emoji", value: "👍" }, "m-1")).toBe(true);
    expect(useBlockCommentStore.getState().messages[0]?.reactions).toEqual([
      { kind: "emoji", value: "👍", memberIds: ["m-1"] },
    ]);
    expect(enqueueAsync).toHaveBeenLastCalledWith(
      "toggleCommentReaction",
      expect.objectContaining({
        id: "c-1",
        workspaceId: "ws-1",
        reactionKind: "emoji",
        reactionValue: "👍",
        reacted: true,
        dedupeId: "c-1:emoji:👍:m-1",
      }),
    );

    expect(store.toggleReaction("c-1", { kind: "emoji", value: "👍" }, "m-1")).toBe(true);
    expect(useBlockCommentStore.getState().messages[0]?.reactions).toEqual([]);
    expect(enqueueAsync).toHaveBeenLastCalledWith(
      "toggleCommentReaction",
      expect.objectContaining({
        id: "c-1",
        reactionKind: "emoji",
        reactionValue: "👍",
        reacted: false,
      }),
    );
  });

  it("댓글 생성 upsert payload 에 reactions AWSJSON 을 포함한다", () => {
    useBlockCommentStore.getState().addMessage({
      id: "c-2",
      pageId: "p-1",
      blockId: "b-1",
      authorMemberId: "m-author",
      bodyText: "반응 포함",
      mentionMemberIds: [],
      reactions: [{ kind: "custom", value: "quicknote-image://asset-1", memberIds: ["m-1"] }],
      parentId: null,
    });

    expect(enqueueAsync).toHaveBeenLastCalledWith(
      "upsertComment",
      expect.objectContaining({
        id: "c-2",
        reactions: JSON.stringify([
          { kind: "custom", value: "quicknote-image://asset-1", memberIds: ["m-1"] },
        ]),
      }),
    );
  });
});
