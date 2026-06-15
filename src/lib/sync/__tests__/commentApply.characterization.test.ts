import { describe, it, expect, beforeEach } from "vitest";
// 5.6 commentApply 추출 전/후 동작 고정용 특성화 테스트.
// 추출 후 import 경로만 ../storeApply/commentApply 로 바뀐다(동작 불변).
import {
  applyRemoteCommentToStore,
  applyRemoteCommentsToStore,
} from "../storeApply/commentApply";
import { useBlockCommentStore } from "../../../store/blockCommentStore";
import { useWorkspaceStore } from "../../../store/workspaceStore";
import type { GqlComment } from "../queries/comment";

const PAGE_COMMENT_SENTINEL = "__page__";

function gqlComment(over: Partial<GqlComment> = {}): GqlComment {
  const now = new Date().toISOString();
  return {
    id: "c-1",
    workspaceId: "ws-1",
    pageId: "pg-1",
    blockId: "blk-1",
    authorMemberId: "m-1",
    bodyText: "hi",
    mentionMemberIds: [],
    parentId: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function messages() {
  return useBlockCommentStore.getState().messages;
}

describe("commentApply 특성화", () => {
  beforeEach(() => {
    useBlockCommentStore.getState().clearMessages();
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-1" });
  });

  it("applyRemoteCommentsToStore 가 정상 댓글을 upsert 한다", () => {
    applyRemoteCommentsToStore([gqlComment({ id: "c-1", bodyText: "안녕" })]);
    const m = messages();
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ id: "c-1", bodyText: "안녕", blockId: "blk-1", parentId: null });
  });

  it("deletedAt 댓글은 제거된다", () => {
    applyRemoteCommentsToStore([gqlComment({ id: "c-1" })]);
    expect(messages()).toHaveLength(1);
    applyRemoteCommentsToStore([gqlComment({ id: "c-1", deletedAt: new Date().toISOString() })]);
    expect(messages()).toHaveLength(0);
  });

  it("pageId/blockId 누락은 무시(throw 없음)", () => {
    applyRemoteCommentsToStore([gqlComment({ id: "bad", pageId: "  " })]);
    applyRemoteCommentsToStore([gqlComment({ id: "bad2", blockId: "" })]);
    expect(messages()).toHaveLength(0);
  });

  it("blockId 가 페이지 댓글 sentinel 이면 허용", () => {
    applyRemoteCommentsToStore([gqlComment({ id: "c-pg", blockId: PAGE_COMMENT_SENTINEL })]);
    expect(messages().find((x) => x.id === "c-pg")?.blockId).toBe(PAGE_COMMENT_SENTINEL);
  });

  it("mentionMemberIds 가 JSON 문자열이면 배열로 파싱", () => {
    applyRemoteCommentsToStore([
      gqlComment({ id: "c-1", mentionMemberIds: JSON.stringify(["m-2", "m-3"]) }),
    ]);
    expect(messages()[0].mentionMemberIds).toEqual(["m-2", "m-3"]);
  });

  it("다른 워크스페이스 댓글은 무시", () => {
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-other" });
    applyRemoteCommentsToStore([gqlComment({ id: "c-1", workspaceId: "ws-1" })]);
    expect(messages()).toHaveLength(0);
  });

  it("단건 applyRemoteCommentToStore upsert + delete", () => {
    applyRemoteCommentToStore(gqlComment({ id: "c-9", bodyText: "x" }));
    expect(messages().find((x) => x.id === "c-9")?.bodyText).toBe("x");
    applyRemoteCommentToStore(gqlComment({ id: "c-9", deletedAt: new Date().toISOString() }));
    expect(messages().find((x) => x.id === "c-9")).toBeUndefined();
  });

  it("빈 배열은 no-op", () => {
    applyRemoteCommentsToStore([gqlComment({ id: "c-1" })]);
    const before = messages();
    applyRemoteCommentsToStore([]);
    expect(messages()).toBe(before);
  });
});
