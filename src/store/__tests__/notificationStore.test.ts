import { beforeEach, describe, expect, it } from "vitest";
import { useBlockCommentStore } from "../blockCommentStore";
import { useNotificationStore } from "../notificationStore";

describe("notificationStore", () => {
  beforeEach(() => {
    useNotificationStore.setState({ items: [] });
    useBlockCommentStore.setState({ messages: [], threadVisitedAt: {} });
  });

  it("댓글 멤버 멘션의 m: prefix 를 제거해서 내 알림으로 조회한다", () => {
    useBlockCommentStore.getState().addMessage({
      id: "c1",
      pageId: "p1",
      blockId: "b1",
      authorMemberId: "author",
      bodyText: "확인 부탁드립니다",
      mentionMemberIds: ["m:me"],
      parentId: null,
    });

    const state = useNotificationStore.getState();
    expect(state.listForMember("me")).toHaveLength(1);
    expect(state.unreadCountForMember("me")).toBe(1);
    expect(state.items[0]?.recipientMemberId).toBe("me");
  });

  it("페이지/DB 멘션은 댓글 알림 대상에서 제외한다", () => {
    useBlockCommentStore.getState().addMessage({
      id: "c1",
      pageId: "p1",
      blockId: "b1",
      authorMemberId: "author",
      bodyText: "페이지 참고",
      mentionMemberIds: ["p:page-1", "d:db-1"],
      parentId: null,
    });

    expect(useNotificationStore.getState().items).toHaveLength(0);
  });

  it("댓글 수정으로 새 멘션이 추가되면 알림을 만든다", () => {
    useBlockCommentStore.getState().addMessage({
      id: "c1",
      pageId: "p1",
      blockId: "b1",
      authorMemberId: "author",
      bodyText: "초안",
      mentionMemberIds: [],
      parentId: null,
    });

    useBlockCommentStore.getState().updateMessage("c1", {
      bodyText: "수정 후 멘션",
      mentionMemberIds: ["m:me"],
    });

    expect(useNotificationStore.getState().listForMember("me")).toHaveLength(1);
  });
});
