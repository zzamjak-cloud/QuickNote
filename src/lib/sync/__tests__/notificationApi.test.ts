import { beforeEach, describe, expect, it, vi } from "vitest";
import { markNotificationsReadApi } from "../notificationApi";

const mocks = vi.hoisted(() => ({ graphql: vi.fn() }));

vi.mock("../graphql/client", () => ({
  appsyncClient: () => ({ graphql: mocks.graphql }),
}));

describe("markNotificationsReadApi", () => {
  beforeEach(() => {
    mocks.graphql.mockReset();
    mocks.graphql.mockResolvedValue({
      data: { markNotificationRead: { notificationId: "n-1", read: true } },
    });
  });

  it("중복 알림 ID를 제거하고 서버 읽음 처리를 호출한다", async () => {
    await markNotificationsReadApi(["n-1", "n-2", "n-1"]);

    expect(mocks.graphql).toHaveBeenCalledTimes(2);
    expect(mocks.graphql).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ variables: { notificationId: "n-1" } }),
    );
    expect(mocks.graphql).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ variables: { notificationId: "n-2" } }),
    );
  });

  it("읽음 처리할 ID가 없으면 서버를 호출하지 않는다", async () => {
    await markNotificationsReadApi([]);

    expect(mocks.graphql).not.toHaveBeenCalled();
  });

  it("일부 알림 동기화가 실패하면 실패를 호출자에게 전달한다", async () => {
    mocks.graphql.mockImplementation(({ variables }: { variables: { notificationId: string } }) =>
      variables.notificationId === "n-2"
        ? Promise.reject(new Error("network"))
        : Promise.resolve({
            data: { markNotificationRead: { notificationId: "n-1", read: true } },
          }),
    );

    await expect(markNotificationsReadApi(["n-1", "n-2"])).rejects.toThrow(
      "알림 1개 읽음 처리에 실패했습니다.",
    );
    expect(mocks.graphql).toHaveBeenCalledTimes(2);
  });
});
