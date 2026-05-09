import { describe, it, expect } from "vitest";
import { buildOutboxEntryMeta } from "../../lib/sync/outboxMeta";

describe("buildOutboxEntryMeta", () => {
  it("upsertPage 는 workspaceId·entityType·entityId 를 채운다", () => {
    const m = buildOutboxEntryMeta("upsertPage", {
      id: "p1",
      workspaceId: "ws-a",
    });
    expect(m).toEqual({
      workspaceId: "ws-a",
      entityType: "page",
      entityId: "p1",
      baseVersion: undefined,
    });
  });

  it("updateMyClientPrefs 는 workspaceId null·memberPrefs", () => {
    const m = buildOutboxEntryMeta("updateMyClientPrefs", { id: "mem-1" });
    expect(m).toEqual({
      workspaceId: null,
      entityType: "memberPrefs",
      entityId: "mem-1",
    });
  });

  it("payload.version 이 있으면 baseVersion 으로 옮긴다", () => {
    const m = buildOutboxEntryMeta("upsertDatabase", {
      id: "d1",
      workspaceId: "ws",
      version: 3,
    });
    expect(m.baseVersion).toBe(3);
  });
});
