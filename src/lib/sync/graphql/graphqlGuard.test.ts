import { describe, expect, it, vi } from "vitest";
import { createGuardedGraphql } from "./graphqlGuard";

describe("createGuardedGraphql", () => {
  it("동일 query와 variables가 동시에 들어오면 같은 in-flight Promise를 재사용한다", async () => {
    const execute = vi.fn(async () => ({ data: { ok: true } }));
    const graphql = createGuardedGraphql(execute);

    const args = {
      query: "query ListTeams { listTeams { teamId } }",
      variables: { workspaceId: "lc-scheduler-global" },
    };

    const [first, second] = await Promise.all([graphql(args), graphql(args)]);

    expect(first).toEqual(second);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("짧은 시간에 같은 operation이 반복되면 circuit breaker로 차단한다", async () => {
    let now = 1_000;
    const execute = vi.fn(async () => ({ data: { ok: true } }));
    const graphql = createGuardedGraphql(execute, {
      now: () => now,
      windowMs: 1_000,
      maxCallsPerWindow: 2,
      blockMs: 5_000,
    });
    const args = { query: "query Me { me { memberId } }" };

    await graphql(args);
    now += 10;
    await graphql(args);
    now += 10;

    await expect(graphql(args)).rejects.toThrow(/GraphQL circuit open/);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
