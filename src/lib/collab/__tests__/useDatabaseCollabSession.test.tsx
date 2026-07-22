import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  providerCallbacks: new Map<string, (arg?: unknown) => void>(),
  providerConnect: vi.fn(),
  providerDestroy: vi.fn(),
  idbDestroy: vi.fn(),
  setStatus: vi.fn(),
}));

vi.mock("../collabConfig", () => ({
  isCollabEnabledForDatabase: () => true,
  buildDbCollabWsUrl: () => "wss://collab.example/db-1",
  collabRoomEpoch: () => "test",
}));

vi.mock("../QnWsProvider", () => ({
  QnWsProvider: class {
    isSynced = false;

    on(event: string, callback: (arg?: unknown) => void) {
      mocks.providerCallbacks.set(event, callback);
    }

    connect() {
      mocks.providerConnect();
    }

    destroy() {
      mocks.providerDestroy();
    }
  },
}));

vi.mock("y-indexeddb", () => ({
  IndexeddbPersistence: class {
    on() {}

    destroy() {
      mocks.idbDestroy();
    }
  },
}));

vi.mock("../../auth/tokenStore", () => ({
  readStoredTokens: vi.fn(async () => ({ idToken: "id-token" })),
}));

vi.mock("../dbCollabRegistry", () => ({
  registerDbCollab: vi.fn(),
  unregisterDbCollab: vi.fn(),
}));

vi.mock("../../../store/collabConnectionStore", () => ({
  useCollabConnectionStore: (selector: (state: { setStatus: typeof mocks.setStatus }) => unknown) =>
    selector({ setStatus: mocks.setStatus }),
}));

vi.mock("../../../store/databaseStore", () => ({
  useDatabaseStore: (
    selector: (state: { databases: Record<string, { meta: { workspaceId: string } }> }) => unknown,
  ) => selector({ databases: { "db-1": { meta: { workspaceId: "ws-1" } } } }),
}));

vi.mock("../../../store/workspaceStore", () => ({
  useWorkspaceStore: (selector: (state: { currentWorkspaceId: string }) => unknown) =>
    selector({ currentWorkspaceId: "ws-1" }),
}));

import { useDatabaseCollabSession } from "../useDatabaseCollabSession";
import { seedDbStructure, type DbStructure } from "../dbBundleYjs";
import { reconcileStructureIntoYDoc } from "../dbStructureReconcile";

describe("useDatabaseCollabSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.providerCallbacks.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("server sync 전에 바꾼 컬럼 타입을 synced 시 최신 구조로 한 번 materialize 한다", async () => {
    const onMaterialize = vi.fn();
    const onSynced = vi.fn();
    const { result } = renderHook(() =>
      useDatabaseCollabSession("db-1", onMaterialize, onSynced),
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.providerConnect).toHaveBeenCalledOnce();

    const textStructure: DbStructure = {
      columns: [{ id: "status", name: "상태", type: "text" }],
      presets: [],
      panelState: {},
      rowPageOrder: [],
      rows: {},
      rowMembers: [],
    };
    const selectStructure: DbStructure = {
      ...textStructure,
      columns: [{ id: "status", name: "상태", type: "select" }],
    };
    act(() => {
      if (!result.current.enabled) throw new Error("DB 협업 세션이 활성화되지 않았습니다.");
      seedDbStructure(result.current.doc, textStructure);
      reconcileStructureIntoYDoc(result.current.doc, selectStructure, textStructure);
      vi.advanceTimersByTime(1_500);
    });
    expect(onMaterialize).not.toHaveBeenCalled();

    act(() => {
      mocks.providerCallbacks.get("synced")?.();
    });
    expect(onSynced).toHaveBeenCalledOnce();
    expect(onMaterialize).toHaveBeenCalledOnce();
    expect(onMaterialize).toHaveBeenCalledWith(
      expect.objectContaining({
        columns: [expect.objectContaining({ id: "status", type: "select" })],
      }),
    );

    act(() => {
      vi.advanceTimersByTime(1_500);
    });
    expect(onMaterialize).toHaveBeenCalledOnce();

    act(() => {
      mocks.providerCallbacks.get("synced")?.();
    });
    expect(onMaterialize).toHaveBeenCalledOnce();
  });
});
