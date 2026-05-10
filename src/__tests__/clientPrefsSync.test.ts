import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  applyRemoteClientPrefs,
  decodeClientPrefsField,
  ensureSettingsPersistHydrated,
} from "../lib/sync/clientPrefsSync";
import { useSettingsStore } from "../store/settingsStore";

describe("decodeClientPrefsField", () => {
  const payload = {
    v: 1,
    favoritePageIds: ["p1"],
    favoritePageIdsUpdatedAt: 99,
  };

  it("객체 한 번 인코딩 문자열을 디코드한다", () => {
    const once = JSON.stringify(payload);
    const r = decodeClientPrefsField(once);
    expect(r).toEqual({
      v: 1,
      favoritePageIds: ["p1"],
      favoritePageIdsUpdatedAt: 99,
    });
  });

  it("이중 JSON 문자열(AppSync AWSJSON 이중 래핑)을 디코드한다", () => {
    const inner = JSON.stringify(payload);
    const double = JSON.stringify(inner);
    const r = decodeClientPrefsField(double);
    expect(r).toEqual({
      v: 1,
      favoritePageIds: ["p1"],
      favoritePageIdsUpdatedAt: 99,
    });
  });

  it("이미 객체이면 그대로 검증한다", () => {
    const r = decodeClientPrefsField(payload);
    expect(r).toEqual({
      v: 1,
      favoritePageIds: ["p1"],
      favoritePageIdsUpdatedAt: 99,
    });
  });
});

describe("applyRemoteClientPrefs", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      favoritePageIds: ["a"],
      favoritePageIdsUpdatedAt: 100,
    });
  });

  it("동일 ts·동일 순서면 상태 유지", () => {
    applyRemoteClientPrefs(
      JSON.stringify({
        v: 1,
        favoritePageIds: ["a"],
        favoritePageIdsUpdatedAt: 100,
      }),
    );
    expect(useSettingsStore.getState().favoritePageIds).toEqual(["a"]);
    expect(useSettingsStore.getState().favoritePageIdsUpdatedAt).toBe(100);
  });

  it("동일 ts·목록만 다르면 원격으로 덮어씀(LWW 동률 시 서버 스냅샷)", () => {
    applyRemoteClientPrefs(
      JSON.stringify({
        v: 1,
        favoritePageIds: ["b"],
        favoritePageIdsUpdatedAt: 100,
      }),
    );
    expect(useSettingsStore.getState().favoritePageIds).toEqual(["b"]);
    expect(useSettingsStore.getState().favoritePageIdsUpdatedAt).toBe(100);
  });

  it("원격 ts 가 더 크면 적용", () => {
    applyRemoteClientPrefs(
      JSON.stringify({
        v: 1,
        favoritePageIds: ["x"],
        favoritePageIdsUpdatedAt: 101,
      }),
    );
    expect(useSettingsStore.getState().favoritePageIds).toEqual(["x"]);
  });

  it("로컬 ts 가 더 크면 유지", () => {
    applyRemoteClientPrefs(
      JSON.stringify({
        v: 1,
        favoritePageIds: ["z"],
        favoritePageIdsUpdatedAt: 99,
      }),
    );
    expect(useSettingsStore.getState().favoritePageIds).toEqual(["a"]);
  });
});

describe("ensureSettingsPersistHydrated", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("이미 복원된 settings store 는 다시 rehydrate 하지 않는다", async () => {
    const hasHydrated = vi
      .spyOn(useSettingsStore.persist, "hasHydrated")
      .mockReturnValue(true);
    const rehydrate = vi.spyOn(useSettingsStore.persist, "rehydrate");

    await ensureSettingsPersistHydrated();

    expect(hasHydrated).toHaveBeenCalled();
    expect(rehydrate).not.toHaveBeenCalled();
  });
});
