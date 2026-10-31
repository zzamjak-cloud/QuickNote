import { beforeEach, describe, expect, it, vi } from "vitest";

const gqlOptional = vi.fn();
vi.mock("./graphqlRequest", () => ({ gqlOptional: (...a: unknown[]) => gqlOptional(...a) }));

import { deleteWorkspaceApi } from "./workspaceApi";

const inProgress = () => Object.assign(new Error("GraphQL error"), {
  errors: [{ message: "WORKSPACE_DELETE_IN_PROGRESS: 진행 중" }],
});

describe("deleteWorkspaceApi", () => {
  beforeEach(() => {
    gqlOptional.mockReset();
  });

  it("진행 중 오류면 완료될 때까지 재호출한다", async () => {
    gqlOptional.mockRejectedValueOnce(inProgress()).mockRejectedValueOnce(inProgress()).mockResolvedValueOnce(true);
    await expect(deleteWorkspaceApi("ws")).resolves.toBe(true);
    expect(gqlOptional).toHaveBeenCalledTimes(3);
  });

  it("다른 오류는 즉시 전파한다", async () => {
    gqlOptional.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(deleteWorkspaceApi("ws")).rejects.toThrow("Forbidden");
    expect(gqlOptional).toHaveBeenCalledTimes(1);
  });

  it("최대 횟수를 넘기면 포기한다", async () => {
    gqlOptional.mockRejectedValue(inProgress());
    await expect(deleteWorkspaceApi("ws")).rejects.toThrow("GraphQL error");
    expect(gqlOptional).toHaveBeenCalledTimes(30);
  });
});
