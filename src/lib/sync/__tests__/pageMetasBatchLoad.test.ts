import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePageStore } from "../../../store/pageStore";
import { usePageMetaRemoteStore } from "../../../store/pageMetaRemoteStore";
import { useSyncWatermarkStore } from "../../../store/syncWatermarkStore";
import {
  fetchPageMetasBatch,
  fetchDatabasesByWorkspace,
} from "../bootstrap";
import { fetchCommentsByWorkspace } from "../commentApi";
import { getSyncEngine } from "../runtime";
import { loadMorePageMetas } from "../pageMetasLoad";
import { refreshWorkspaceSnapshot } from "../workspaceSwitch";
import { fetchApplyWorkspaceRemoteMetaSnapshot } from "../workspaceSnapshotBootstrap";

vi.mock("../bootstrap", () => ({
  fetchPageMetasBatch: vi.fn(),
  fetchDatabasesByWorkspace: vi.fn(),
  fetchPagesByWorkspace: vi.fn(),
}));
vi.mock("../commentApi", () => ({
  fetchCommentsByWorkspace: vi.fn(),
}));
vi.mock("../runtime", () => ({
  getSyncEngine: vi.fn(),
}));
vi.mock("../workspaceLanding", () => ({
  applyWorkspaceLanding: vi.fn(),
}));
vi.mock("../workspaceSwitch", () => ({
  clearWorkspaceScopedStores: vi.fn(),
  refreshWorkspaceSnapshot: vi.fn(),
}));

const fetchPageMetasMock = vi.mocked(fetchPageMetasBatch);
const fetchDatabasesMock = vi.mocked(fetchDatabasesByWorkspace);
const fetchCommentsMock = vi.mocked(fetchCommentsByWorkspace);
const getSyncEngineMock = vi.mocked(getSyncEngine);
const refreshWorkspaceSnapshotMock = vi.mocked(refreshWorkspaceSnapshot);

const WS = "ws-test";

function makePageMeta(id: string, updatedAt: string) {
  return { id, workspaceId: WS, title: id, updatedAt, createdAt: updatedAt, deletedAt: null };
}

beforeEach(() => {
  vi.resetAllMocks();
  usePageStore.setState({ pages: {}, activePageId: null, cacheWorkspaceId: null });
  usePageMetaRemoteStore.setState({ nextTokenByWorkspaceId: {}, loadingByWorkspaceId: {} });
  useSyncWatermarkStore.setState({ byWorkspace: {} });
  getSyncEngineMock.mockResolvedValue({ getPendingUpsertEntityIds: vi.fn().mockResolvedValue({ pages: new Set(), databases: new Set() }) } as never);
  fetchDatabasesMock.mockResolvedValue([]);
  fetchCommentsMock.mockResolvedValue([]);
});

describe("fetchApplyWorkspaceRemoteMetaSnapshot — 단일 배치 로드", () => {
  it("fetchPageMetasBatch 결과가 pageStore 에 즉시 적용된다", async () => {
    const items = [
      makePageMeta("p1", "2026-01-01T00:00:00.000Z"),
      makePageMeta("p2", "2026-01-02T00:00:00.000Z"),
    ];
    fetchPageMetasMock.mockResolvedValue({ items, nextToken: null });

    await fetchApplyWorkspaceRemoteMetaSnapshot({
      workspaceId: WS,
      refreshSnapshotAfterApply: false,
    });

    const pages = usePageStore.getState().pages;
    expect(pages["p1"]).toBeDefined();
    expect(pages["p2"]).toBeDefined();
  });

  it("nextToken 이 있으면 pageMetaRemoteStore 에 저장된다", async () => {
    const items = [makePageMeta("p1", "2026-01-01T00:00:00.000Z")];
    const token = "eyJuZXh0IjoidG9rZW4ifQ==";
    fetchPageMetasMock.mockResolvedValue({ items, nextToken: token });

    await fetchApplyWorkspaceRemoteMetaSnapshot({ workspaceId: WS });

    expect(usePageMetaRemoteStore.getState().nextTokenByWorkspaceId[WS]).toBe(token);
  });

  it("초기 메타 배치가 미완료이면 workspace snapshot 을 저장하지 않는다", async () => {
    const items = [makePageMeta("p1", "2026-01-01T00:00:00.000Z")];
    fetchPageMetasMock.mockResolvedValue({ items, nextToken: "next-token" });

    await fetchApplyWorkspaceRemoteMetaSnapshot({
      workspaceId: WS,
      refreshSnapshotAfterApply: true,
    });

    expect(refreshWorkspaceSnapshotMock).not.toHaveBeenCalled();
  });

  it("초기 메타 배치가 완료되면 workspace snapshot 을 저장한다", async () => {
    const items = [makePageMeta("p1", "2026-01-01T00:00:00.000Z")];
    fetchPageMetasMock.mockResolvedValue({ items, nextToken: null });

    await fetchApplyWorkspaceRemoteMetaSnapshot({
      workspaceId: WS,
      refreshSnapshotAfterApply: true,
    });

    expect(refreshWorkspaceSnapshotMock).toHaveBeenCalledWith(WS);
  });

  it("추가 메타 배치가 미완료이면 workspace snapshot 을 저장하지 않는다", async () => {
    usePageMetaRemoteStore.setState({
      nextTokenByWorkspaceId: { [WS]: "token-1" },
      loadingByWorkspaceId: {},
    });
    fetchPageMetasMock.mockResolvedValue({
      items: [makePageMeta("p2", "2026-01-02T00:00:00.000Z")],
      nextToken: "token-2",
    });

    await loadMorePageMetas(WS);

    expect(refreshWorkspaceSnapshotMock).not.toHaveBeenCalled();
  });

  it("마지막 추가 메타 배치에서만 workspace snapshot 을 저장한다", async () => {
    usePageMetaRemoteStore.setState({
      nextTokenByWorkspaceId: { [WS]: "token-1" },
      loadingByWorkspaceId: {},
    });
    fetchPageMetasMock.mockResolvedValue({
      items: [makePageMeta("p2", "2026-01-02T00:00:00.000Z")],
      nextToken: null,
    });

    await loadMorePageMetas(WS);

    expect(refreshWorkspaceSnapshotMock).toHaveBeenCalledWith(WS);
  });

  it("모든 도메인 성공 시 최대 updatedAt 으로 워터마크를 전진시킨다", async () => {
    const items = [
      makePageMeta("p1", "2026-01-01T00:00:00.000Z"),
      makePageMeta("p2", "2026-01-03T00:00:00.000Z"),
    ];
    fetchPageMetasMock.mockResolvedValue({ items, nextToken: null });

    await fetchApplyWorkspaceRemoteMetaSnapshot({ workspaceId: WS });

    expect(useSyncWatermarkStore.getState().getWatermark(WS)).toBe(
      "2026-01-03T00:00:00.000Z",
    );
  });

  it("페이지 메타 실패 시 워터마크를 전진시키지 않는다", async () => {
    fetchPageMetasMock.mockRejectedValue(new Error("network error"));

    await fetchApplyWorkspaceRemoteMetaSnapshot({ workspaceId: WS });

    expect(useSyncWatermarkStore.getState().getWatermark(WS)).toBeUndefined();
  });
});
