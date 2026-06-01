import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "../settingsStore";

describe("settingsStore scheduler member order", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z"));
    useSettingsStore.setState({
      schedulerMemberOrder: [],
      schedulerMemberOrderUpdatedAt: 0,
    });
  });

  it("구성원 탭 순서를 저장하고 clientPrefs 동기화 타임스탬프를 갱신한다", () => {
    useSettingsStore.getState().reorderSchedulerMembers(["member-3", "member-1"]);

    expect(useSettingsStore.getState().schedulerMemberOrder).toEqual([
      "member-3",
      "member-1",
    ]);
    expect(useSettingsStore.getState().schedulerMemberOrderUpdatedAt).toBe(
      Date.parse("2026-06-01T00:00:00.000Z"),
    );
  });
});
