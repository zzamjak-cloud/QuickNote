import { afterEach, describe, expect, it, vi } from "vitest";
import { useDatabaseStore } from "../../../store/databaseStore";
import { ensureDatabasePersistHydrated } from "../persistHydration";

describe("ensureDatabasePersistHydrated", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("DB persist가 미복원 상태면 원격 스냅샷 전에 rehydrate를 기다린다", async () => {
    vi.spyOn(useDatabaseStore.persist, "hasHydrated").mockReturnValue(false);
    const rehydrate = vi
      .spyOn(useDatabaseStore.persist, "rehydrate")
      .mockResolvedValue(undefined);

    await ensureDatabasePersistHydrated();

    expect(rehydrate).toHaveBeenCalledTimes(1);
  });

  it("이미 복원된 상태면 중복 rehydrate하지 않는다", async () => {
    vi.spyOn(useDatabaseStore.persist, "hasHydrated").mockReturnValue(true);
    const rehydrate = vi.spyOn(useDatabaseStore.persist, "rehydrate");

    await ensureDatabasePersistHydrated();

    expect(rehydrate).not.toHaveBeenCalled();
  });
});
