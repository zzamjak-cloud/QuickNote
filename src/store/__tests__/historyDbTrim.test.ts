import { beforeEach, describe, expect, it } from "vitest";
import {
  repairDbHistoryBaselineIfNeeded,
  trimDbEventsByRetention,
  useHistoryStore,
} from "../historyStore";
import type { DatabaseSnapshot, DbHistoryEvent } from "../../types/history";
import { HISTORY_RETENTION_MAX_EVENTS } from "../../types/history";

function baseSnap(dbId: string): DatabaseSnapshot {
  return {
    meta: { id: dbId, title: "T", createdAt: 1, updatedAt: 1 },
    columns: [{ id: "c1", name: "제목", type: "title", config: {} }],
    rowPageOrder: [],
  };
}

describe("repairDbHistoryBaselineIfNeeded", () => {
  beforeEach(() => {
    useHistoryStore.setState({
      pageEventsByPageId: {},
      dbEventsByDatabaseId: {},
      deletedRowTombstonesByDbId: {},
      cacheWorkspaceId: null,
    });
  });

  it("db.create 없이 패치만 있으면 지우고 베이스라인을 심는다", () => {
    const dbId = "db-orphan";
    const snap = baseSnap(dbId);
    useHistoryStore.getState().recordDbEvent(dbId, "db.row.add", {
      rowPageOrder: ["page-1"],
    });
    const before = useHistoryStore.getState().dbEventsByDatabaseId[dbId] ?? [];
    expect(before.some((e) => e.kind === "db.create")).toBe(false);

    repairDbHistoryBaselineIfNeeded(dbId, snap);
    const after = useHistoryStore.getState().dbEventsByDatabaseId[dbId] ?? [];
    expect(after.some((e) => e.kind === "db.create")).toBe(true);
  });
});

describe("trimDbEventsByRetention", () => {
  it("db.create 가 max 이벤트 초과 시에도 유지된다", () => {
    const dbId = "db-test";
    const snap = baseSnap(dbId);
    const create: DbHistoryEvent = {
      id: "ev-create",
      ts: 1000,
      kind: "db.create",
      databaseId: dbId,
      workspaceId: "ws-1",
      patch: structuredClone(snap),
      anchor: structuredClone(snap),
    };
    const filler: DbHistoryEvent[] = Array.from(
      { length: HISTORY_RETENTION_MAX_EVENTS + 50 },
      (_, i) => ({
        id: `ev-${i}`,
        ts: 2000 + i,
        kind: "db.title" as const,
        databaseId: dbId,
        workspaceId: "ws-1",
        patch: { meta: { ...snap.meta, title: `t${i}`, updatedAt: 2000 + i } },
      }),
    );
    const trimmed = trimDbEventsByRetention([create, ...filler]);
    expect(trimmed.some((e) => e.id === "ev-create")).toBe(true);
    expect(trimmed.length).toBeLessThanOrEqual(HISTORY_RETENTION_MAX_EVENTS);
  });
});
