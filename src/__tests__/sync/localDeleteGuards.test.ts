import { describe, it, expect, beforeEach } from "vitest";
import {
  markLocallyDeletedEntity,
  markPermanentlyDeletedEntity,
  shouldIgnoreRemoteAfterLocalDelete,
  isPermanentlyDeletedEntity,
  pruneLocalDeleteGuardsOnStartup,
} from "../../lib/sync/localDeleteGuards";

const GUARDS_KEY = "quicknote.sync.localDeleteGuards.v1";
const DAY_MS = 24 * 60 * 60 * 1000;

function setGuardsRaw(data: Record<string, unknown>): void {
  localStorage.setItem(GUARDS_KEY, JSON.stringify(data));
}

beforeEach(() => {
  localStorage.clear();
});

describe("markLocallyDeletedEntity", () => {
  it("이후 원격 업데이트를 차단한다", () => {
    const now = Date.now();
    markLocallyDeletedEntity("page", "p1", "ws1", now);
    const remoteAt = new Date(now - 1).toISOString();
    expect(shouldIgnoreRemoteAfterLocalDelete("page", "p1", "ws1", remoteAt)).toBe(true);
  });

  it("삭제 이후 원격 업데이트는 통과한다", () => {
    const now = Date.now();
    markLocallyDeletedEntity("page", "p1", "ws1", now);
    const remoteAt = new Date(now + 1000).toISOString();
    expect(shouldIgnoreRemoteAfterLocalDelete("page", "p1", "ws1", remoteAt)).toBe(false);
  });

  it("7일 TTL 경과 시 guard 만료 — 원격 업데이트 통과", () => {
    const deletedAt = Date.now() - 8 * DAY_MS;
    markLocallyDeletedEntity("page", "p1", "ws1", deletedAt);
    const remoteAt = new Date(deletedAt - 1).toISOString();
    // pruneGuards 는 다음 read 시 nowMs 기준으로 실행되므로, 만료 후에는 false 반환.
    expect(shouldIgnoreRemoteAfterLocalDelete("page", "p1", "ws1", remoteAt)).toBe(false);
  });
});

describe("markPermanentlyDeletedEntity", () => {
  it("permanent flag 가 설정된다", () => {
    markPermanentlyDeletedEntity("database", "db1", "ws1");
    expect(isPermanentlyDeletedEntity("database", "db1", "ws1")).toBe(true);
  });

  it("timestamp 비교 없이 모든 원격 업데이트를 차단한다", () => {
    markPermanentlyDeletedEntity("page", "p1", "ws1");
    const futureAt = new Date(Date.now() + 999 * DAY_MS).toISOString();
    expect(shouldIgnoreRemoteAfterLocalDelete("page", "p1", "ws1", futureAt)).toBe(true);
  });
});

describe("permanent tombstone TTL (30일)", () => {
  it("29일 경과 → 여전히 차단", () => {
    const deletedAt = Date.now() - 29 * DAY_MS;
    setGuardsRaw({ "page:ws1:p1": { deletedAtMs: deletedAt, permanent: true } });
    const remoteAt = new Date(deletedAt - 1).toISOString();
    expect(shouldIgnoreRemoteAfterLocalDelete("page", "p1", "ws1", remoteAt)).toBe(true);
  });

  it("30일 경계 — 정확히 30일 미만이면 유지", () => {
    const deletedAt = Date.now() - (30 * DAY_MS - 1000);
    setGuardsRaw({ "page:ws1:p1": { deletedAtMs: deletedAt, permanent: true } });
    const remoteAt = new Date(deletedAt - 1).toISOString();
    expect(shouldIgnoreRemoteAfterLocalDelete("page", "p1", "ws1", remoteAt)).toBe(true);
  });

  it("31일 경과 → 만료되어 원격 업데이트 통과", () => {
    const deletedAt = Date.now() - 31 * DAY_MS;
    setGuardsRaw({ "page:ws1:p1": { deletedAtMs: deletedAt, permanent: true } });
    const remoteAt = new Date(deletedAt - 1).toISOString();
    expect(shouldIgnoreRemoteAfterLocalDelete("page", "p1", "ws1", remoteAt)).toBe(false);
  });

  it("31일 경과 → isPermanentlyDeletedEntity 도 false", () => {
    const deletedAt = Date.now() - 31 * DAY_MS;
    setGuardsRaw({ "page:ws1:p1": { deletedAtMs: deletedAt, permanent: true } });
    expect(isPermanentlyDeletedEntity("page", "p1", "ws1")).toBe(false);
  });
});

describe("pruneLocalDeleteGuardsOnStartup", () => {
  it("만료된 permanent tombstone 을 localStorage 에서 제거한다", () => {
    const expiredAt = Date.now() - 31 * DAY_MS;
    const validAt = Date.now() - 1 * DAY_MS;
    setGuardsRaw({
      "page:ws1:expired": { deletedAtMs: expiredAt, permanent: true },
      "page:ws1:valid": { deletedAtMs: validAt, permanent: true },
    });

    pruneLocalDeleteGuardsOnStartup();

    const raw = localStorage.getItem(GUARDS_KEY);
    const parsed = JSON.parse(raw ?? "{}") as Record<string, unknown>;
    expect("page:ws1:expired" in parsed).toBe(false);
    expect("page:ws1:valid" in parsed).toBe(true);
  });

  it("localStorage 가 비어있을 때 조용히 처리된다", () => {
    expect(() => pruneLocalDeleteGuardsOnStartup()).not.toThrow();
  });
});
