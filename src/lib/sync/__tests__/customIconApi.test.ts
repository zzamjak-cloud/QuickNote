import { beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeCustomIcons } from "../customIconApi";

const mocks = vi.hoisted(() => ({
  graphql: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock("../graphql/client", () => ({
  appsyncClient: () => ({ graphql: mocks.graphql }),
}));

vi.mock("../../auth/apiTokens", () => ({
  ensureFreshTokensForAppSync: vi.fn(async () => ({
    idToken: "id-token",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  })),
}));

describe("subscribeCustomIcons", () => {
  beforeEach(() => {
    mocks.graphql.mockReset();
    mocks.subscribe.mockReset();
    mocks.unsubscribe.mockReset();
    mocks.subscribe.mockReturnValue({ unsubscribe: mocks.unsubscribe });
    mocks.graphql.mockReturnValue({ subscribe: mocks.subscribe });
  });

  it("AppSync subscription에 Authorization header를 전달한다", async () => {
    const sub = subscribeCustomIcons("ws-1", vi.fn());

    await vi.waitFor(() => expect(mocks.graphql).toHaveBeenCalledTimes(1));

    expect(mocks.graphql).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { workspaceId: "ws-1" },
        authMode: "none",
      }),
      { Authorization: "id-token" },
    );

    sub.unsubscribe();
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
