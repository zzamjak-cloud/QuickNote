import { describe, it, expect } from "vitest";
import { mapAwarenessToUsers } from "../useCollabPresence";

type State = Map<number, { user?: { memberId?: string; name?: string; color?: string; avatarUrl?: string } }>;

describe("mapAwarenessToUsers", () => {
  it("로컬 clientId 는 제외한다", () => {
    const states: State = new Map([
      [1, { user: { memberId: "me", name: "Me", color: "#2563eb" } }],
      [2, { user: { memberId: "b", name: "B", color: "#059669" } }],
    ]);
    const users = mapAwarenessToUsers(states, 1);
    expect(users.map((u) => u.clientId)).toEqual([2]);
  });

  it("user 필드 없는 상태는 무시한다", () => {
    const states: State = new Map([[2, {}]]);
    expect(mapAwarenessToUsers(states, 1)).toEqual([]);
  });

  it("같은 memberId 다중 탭은 1명으로 dedupe 한다", () => {
    const states: State = new Map([
      [2, { user: { memberId: "b", name: "B", color: "#059669" } }],
      [3, { user: { memberId: "b", name: "B", color: "#059669" } }],
    ]);
    const users = mapAwarenessToUsers(states, 1);
    expect(users.length).toBe(1);
    expect(users[0].memberId).toBe("b");
  });
});
