import { describe, expect, it } from "vitest";
import type { OutboxEntry } from "../../lib/sync/outbox/types";
import {
  resolveEntryWorkspaceId,
  sortOutboxBatchForFlush,
} from "../../lib/sync/outboxFlushOrder";

function entry(overrides: Partial<OutboxEntry> & Pick<OutboxEntry, "id" | "op">): OutboxEntry {
  return {
    enqueuedAt: 0,
    attempts: 0,
    dedupeKey: `${overrides.op}:${overrides.id}`,
    payload: {},
    ...overrides,
  };
}

describe("resolveEntryWorkspaceId", () => {
  it("메타 워크스페이스를 우선한다", () => {
    const e = entry({
      id: "x",
      op: "upsertPage",
      workspaceId: "ws-meta",
      payload: { workspaceId: "ws-payload" },
    });
    expect(resolveEntryWorkspaceId(e)).toBe("ws-meta");
  });

  it("메타가 비면 payload.workspaceId 를 쓴다", () => {
    const e = entry({
      id: "x",
      op: "upsertPage",
      workspaceId: null,
      payload: { workspaceId: "ws-payload" },
    });
    expect(resolveEntryWorkspaceId(e)).toBe("ws-payload");
  });
});

describe("sortOutboxBatchForFlush", () => {
  it("UI 워크스페이스가 없으면 입력 순서를 유지한다", () => {
    const a = entry({ id: "a", op: "upsertPage", workspaceId: "ws-1", enqueuedAt: 1 });
    const b = entry({ id: "b", op: "upsertPage", workspaceId: "ws-2", enqueuedAt: 2 });
    expect(sortOutboxBatchForFlush([a, b], null)).toEqual([a, b]);
    expect(sortOutboxBatchForFlush([a, b], "  ")).toEqual([a, b]);
  });

  it("현재 WS 페이지/DB 뮤테이션 → prefs → 소속 불명 → 다른 WS 순으로 정렬한다", () => {
    const prefs = entry({
      id: "mem",
      op: "updateMyClientPrefs",
      enqueuedAt: 10,
      payload: { clientPrefs: "{}" },
    });
    const current = entry({
      id: "p1",
      op: "upsertPage",
      workspaceId: "ws-here",
      enqueuedAt: 20,
    });
    const unknown = entry({
      id: "p2",
      op: "upsertPage",
      enqueuedAt: 30,
      payload: {},
    });
    const remote = entry({
      id: "p3",
      op: "upsertPage",
      workspaceId: "ws-there",
      enqueuedAt: 40,
    });
    const batch = sortOutboxBatchForFlush([prefs, remote, unknown, current], "ws-here");
    expect(batch.map((e) => e.id)).toEqual(["p1", "mem", "p2", "p3"]);
  });

  it("동일 순위에서는 기존 배치 순서를 유지한다", () => {
    const older = entry({
      id: "o1",
      op: "upsertPage",
      workspaceId: "ws-here",
      enqueuedAt: 100,
    });
    const newer = entry({
      id: "o2",
      op: "upsertPage",
      workspaceId: "ws-here",
      enqueuedAt: 200,
    });
    const batch = sortOutboxBatchForFlush([newer, older], "ws-here");
    expect(batch.map((e) => e.id)).toEqual(["o2", "o1"]);
  });
});
