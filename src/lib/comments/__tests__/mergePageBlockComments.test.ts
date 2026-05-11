import { describe, expect, it } from "vitest";
import { mergePageBlockComments } from "../mergePageBlockComments";

describe("mergePageBlockComments", () => {
  it("원격이 비어 있으면 로컬 스레드를 유지한다", () => {
    const local = {
      messages: [
        {
          id: "c1",
          pageId: "p1",
          blockId: "b1",
          authorMemberId: "a",
          bodyText: "로컬",
          mentionMemberIds: [] as string[],
          parentId: null,
          createdAt: 1,
        },
      ],
      threadVisitedAt: {},
    };
    expect(mergePageBlockComments(undefined, local)).toEqual(local);
  });

  it("원격·로컬 id 를 합친다", () => {
    const local = {
      messages: [
        {
          id: "c1",
          pageId: "p1",
          blockId: "b1",
          authorMemberId: "a",
          bodyText: "a",
          mentionMemberIds: [],
          parentId: null,
          createdAt: 1,
        },
      ],
      threadVisitedAt: { x: 1 },
    };
    const remote = {
      messages: [
        {
          id: "c2",
          pageId: "p1",
          blockId: "b2",
          authorMemberId: "b",
          bodyText: "b",
          mentionMemberIds: [],
          parentId: null,
          createdAt: 2,
        },
      ],
      threadVisitedAt: { y: 2 },
    };
    const m = mergePageBlockComments(remote, local)!;
    expect(m.messages.map((x) => x.id).sort()).toEqual(["c1", "c2"]);
    expect(m.threadVisitedAt).toEqual({ x: 1, y: 2 });
  });
});
