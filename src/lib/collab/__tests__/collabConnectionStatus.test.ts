import { describe, it, expect } from "vitest";
import { toBadgeStatus } from "../collabConnectionStatus";

describe("toBadgeStatus", () => {
  it("offline provider status → offline", () => {
    expect(toBadgeStatus("offline", false)).toBe("offline");
  });
  it("connected + synced → online", () => {
    expect(toBadgeStatus("connected", true)).toBe("online");
  });
  it("connected 지만 아직 sync 안 됨 → reconnecting", () => {
    expect(toBadgeStatus("connected", false)).toBe("reconnecting");
  });
  it("connecting/disconnected → reconnecting", () => {
    expect(toBadgeStatus("connecting", false)).toBe("reconnecting");
    expect(toBadgeStatus("disconnected", false)).toBe("reconnecting");
  });
});
