import { describe, it, expect } from "vitest";
import { isRemoteWinner, mergeRemote } from "../../lib/sync/lww";

describe("isRemoteWinner", () => {
  it("returns true when remote.updatedAt is later", () => {
    const local = { id: "a", updatedAt: "2026-05-06T00:00:00Z" };
    const remote = { id: "a", updatedAt: "2026-05-06T00:00:01Z" };
    expect(isRemoteWinner(local, remote)).toBe(true);
  });

  it("returns false when local is later or equal", () => {
    const local = { id: "a", updatedAt: "2026-05-06T00:00:01Z" };
    const remote = { id: "a", updatedAt: "2026-05-06T00:00:00Z" };
    expect(isRemoteWinner(local, remote)).toBe(false);
    expect(isRemoteWinner(local, local)).toBe(false);
  });

  it("treats deletedAt-set remote as winner regardless of updatedAt", () => {
    const local: { id: string; updatedAt: string; deletedAt: string | null } = {
      id: "a",
      updatedAt: "2026-05-06T00:00:10Z",
      deletedAt: null,
    };
    const remote: { id: string; updatedAt: string; deletedAt: string | null } = {
      id: "a",
      updatedAt: "2026-05-06T00:00:05Z",
      deletedAt: "2026-05-06T00:00:05Z",
    };
    expect(isRemoteWinner(local, remote)).toBe(true);
  });
});

describe("mergeRemote", () => {
  it("returns remote when remote wins", () => {
    const local = { id: "a", updatedAt: "2026-05-06T00:00:00Z" };
    const remote = { id: "a", updatedAt: "2026-05-06T00:00:01Z" };
    expect(mergeRemote(local, remote)).toBe(remote);
  });
  it("returns local when local wins", () => {
    const local = { id: "a", updatedAt: "2026-05-06T00:00:01Z" };
    const remote = { id: "a", updatedAt: "2026-05-06T00:00:00Z" };
    expect(mergeRemote(local, remote)).toBe(local);
  });
});
