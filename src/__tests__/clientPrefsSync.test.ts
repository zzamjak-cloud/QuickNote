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
  const decodedPayload = {
    v: 1,
    favoritePageIds: ["p1"],
    favoritePageIdsUpdatedAt: 99,
    favoritePageMetaById: {},
    fullWidth: undefined,
    pageFullWidthById: {},
    fullWidthUpdatedAt: 0,
  };

  it("객체 한 번 인코딩 문자열을 디코드한다", () => {
    const once = JSON.stringify(payload);
    const r = decodeClientPrefsField(once);
    expect(r).toEqual(decodedPayload);
  });

  it("이중 JSON 문자열(AppSync AWSJSON 이중 래핑)을 디코드한다", () => {
    const inner = JSON.stringify(payload);
    const double = JSON.stringify(inner);
    const r = decodeClientPrefsField(double);
    expect(r).toEqual(decodedPayload);
  });

  it("이미 객체이면 그대로 검증한다", () => {
    const r = decodeClientPrefsField(payload);
    expect(r).toEqual(decodedPayload);
  });

  it("v2 즐겨찾기 메타를 디코드한다", () => {
    const r = decodeClientPrefsField({
      v: 2,
      favoritePageIds: ["p1"],
      favoritePageIdsUpdatedAt: 99,
      favoritePageMetaById: {
        p1: {
          pageId: "p1",
          workspaceId: "ws-1",
          workspaceName: "Workspace",
          pageTitle: "Page",
          pageIcon: null,
        },
      },
    });
    expect(r?.favoritePageMetaById?.p1?.workspaceId).toBe("ws-1");
    expect(r?.favoritePageMetaById?.p1?.pageTitle).toBe("Page");
  });
});

describe("applyRemoteClientPrefs", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      favoritePageIds: ["a"],
      favoritePageMetaById: {},
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

describe("applyRemoteClientPrefs 전체너비(pageFullWidthById) union 병합", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      favoritePageIds: [],
      favoritePageMetaById: {},
      favoritePageIdsUpdatedAt: 0,
      fullWidth: false,
      pageFullWidthById: { local: true, shared: true },
      fullWidthUpdatedAt: 100,
    });
  });

  it("원격이 더 새면 union 병합 — 로컬에만 있는 항목 보존, 충돌은 원격 우선", () => {
    applyRemoteClientPrefs(
      JSON.stringify({
        v: 1,
        favoritePageIds: [],
        favoritePageIdsUpdatedAt: 0,
        fullWidth: false,
        pageFullWidthById: { remote: true, shared: false },
        fullWidthUpdatedAt: 200,
      }),
    );
    const s = useSettingsStore.getState();
    expect(s.pageFullWidthById).toEqual({
      local: true,
      remote: true,
      shared: false,
    });
    expect(s.fullWidthUpdatedAt).toBe(200);
  });

  it("원격이 더 오래돼도 로컬에 없는 항목은 채워넣는다(로컬 값 우선)", () => {
    applyRemoteClientPrefs(
      JSON.stringify({
        v: 1,
        favoritePageIds: [],
        favoritePageIdsUpdatedAt: 0,
        fullWidth: false,
        pageFullWidthById: { older: true, shared: false },
        fullWidthUpdatedAt: 50,
      }),
    );
    const s = useSettingsStore.getState();
    expect(s.pageFullWidthById).toEqual({
      local: true,
      shared: true,
      older: true,
    });
    // 타임스탬프는 로컬 유지
    expect(s.fullWidthUpdatedAt).toBe(100);
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
