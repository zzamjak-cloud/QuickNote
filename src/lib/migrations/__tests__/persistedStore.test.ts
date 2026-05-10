import { describe, expect, it } from "vitest";
import {
  attachPersistedMeta,
  mergePersistedSubset,
  migratePersistedStore,
  omitPersistStoreMeta,
} from "../persistedStore";

describe("migratePersistedStore", () => {
  it("객체가 아닌 persisted 값은 fallback 에서 시작한다", () => {
    const migrated = migratePersistedStore(
      null,
      0,
      [{ version: 1, migrate: (state) => ({ ...state, ok: true }) }],
      { seed: true },
    );

    expect(migrated).toEqual({ seed: true, ok: true });
  });

  it("fromVersion 이후 migration 만 version 순서대로 적용한다", () => {
    const migrated = migratePersistedStore(
      { value: "a" },
      1,
      [
        { version: 3, migrate: (state) => ({ ...state, c: true }) },
        { version: 1, migrate: (state) => ({ ...state, shouldSkip: true }) },
        { version: 2, migrate: (state) => ({ ...state, b: true }) },
      ],
      {},
    );

    expect(migrated).toEqual({ value: "a", b: true, c: true });
  });

  it("validation 실패 시 fallback 과 quarantine 을 반환한다", () => {
    const migrated = migratePersistedStore(
      { pages: "broken" },
      1,
      [{ version: 2, migrate: (state) => state }],
      { pages: {} },
      {
        validate: (state) =>
          Boolean(state.pages && typeof state.pages === "object"),
        quarantineReason: "bad-pages",
        now: () => "2026-01-01T00:00:00.000Z",
      },
    );

    expect(migrated).toEqual({
      pages: {},
      migrationQuarantine: [
        {
          reason: "bad-pages",
          createdAt: "2026-01-01T00:00:00.000Z",
          fromVersion: 1,
          value: { pages: "broken" },
        },
      ],
    });
  });
});

describe("attachPersistedMeta", () => {
  it("persist 객체에 공통 메타 필드를 얹는다", () => {
    const next = attachPersistedMeta(
      { pages: {}, foo: 1 },
      { persistedWorkspaceId: "ws-1", migratedAt: "2026-01-01T00:00:00.000Z" },
    );
    expect(next.pages).toEqual({});
    expect(next.foo).toBe(1);
    expect(next.persistedWorkspaceId).toBe("ws-1");
    expect(next.migratedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("omitPersistStoreMeta / mergePersistedSubset", () => {
  it("omitPersistStoreMeta 는 공통 메타 키만 제거한다", () => {
    const cleaned = omitPersistStoreMeta({
      pages: { a: 1 },
      schemaVersion: 2,
      persistedWorkspaceId: "ws-1",
      migratedAt: "2026-01-01T00:00:00.000Z",
      extra: true,
    });
    expect(cleaned).toEqual({ pages: { a: 1 }, extra: true });
  });

  it("mergePersistedSubset 은 메타를 제외한 dataKeys 만 병합한다", () => {
    type S = { pages: Record<string, number>; active: string | null; fn: () => void };
    const full: S = {
      pages: {},
      active: null,
      fn: () => {},
    };
    const merged = mergePersistedSubset(
      attachPersistedMeta(
        { pages: { x: 1 }, active: "p1", schemaVersion: 2 },
        { persistedWorkspaceId: "ws-9" },
      ),
      full,
      ["pages", "active"],
    );
    expect(merged.pages).toEqual({ x: 1 });
    expect(merged.active).toBe("p1");
    expect(merged.fn).toBe(full.fn);
    expect("schemaVersion" in merged).toBe(false);
    expect("persistedWorkspaceId" in merged).toBe(false);
  });
});
