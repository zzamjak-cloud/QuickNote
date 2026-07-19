import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePagePublishStatusStore } from "../../../store/pagePublishStatusStore";
import { useSettingsStore } from "../../../store/settingsStore";
import { flushClientPrefsToServerNow } from "../clientPrefsSync";
import { getPagePublishStatusApi, publishPageApi } from "../publishApi";
import { refreshPublishedLayoutSnapshot } from "../publishedLayoutRefresh";

vi.mock("../clientPrefsSync", () => ({
  flushClientPrefsToServerNow: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../publishApi", () => ({
  getPagePublishStatusApi: vi.fn(),
  publishPageApi: vi.fn(),
}));

const flushMock = vi.mocked(flushClientPrefsToServerNow);
const getStatusMock = vi.mocked(getPagePublishStatusApi);
const publishMock = vi.mocked(publishPageApi);

function makeStatus(published: boolean) {
  return {
    pageId: "page-1",
    workspaceId: "ws-1",
    published,
    token: published ? "token-1" : null,
    publishedAt: published ? "2026-07-19T00:00:00.000Z" : null,
  };
}

describe("refreshPublishedLayoutSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePagePublishStatusStore.setState({ statusByPageId: {} });
    useSettingsStore.setState({
      fullWidth: true,
      pageFullWidthById: { "page-1": false, "child-1": true },
    });
    getStatusMock.mockResolvedValue(makeStatus(true));
    publishMock.mockResolvedValue(makeStatus(true));
  });

  it("게시 상태가 확인된 페이지는 clientPrefs 저장 후 publishPage로 레이아웃 스냅샷을 갱신한다", async () => {
    usePagePublishStatusStore.getState().setPublished("page-1", true);

    await expect(refreshPublishedLayoutSnapshot("page-1")).resolves.toBe(true);

    expect(getStatusMock).not.toHaveBeenCalled();
    expect(flushMock).toHaveBeenCalledTimes(1);
    expect(publishMock).toHaveBeenCalledWith("page-1", {
      fullWidth: false,
      fullWidthDefault: true,
      fullWidthById: { "page-1": false, "child-1": true },
    });
  });

  it("게시 상태 캐시가 없으면 상태를 먼저 조회한 뒤 게시된 페이지만 갱신한다", async () => {
    await expect(refreshPublishedLayoutSnapshot("page-1")).resolves.toBe(true);

    expect(getStatusMock).toHaveBeenCalledWith("page-1");
    expect(flushMock).toHaveBeenCalledTimes(1);
    expect(publishMock).toHaveBeenCalledWith("page-1", {
      fullWidth: false,
      fullWidthDefault: true,
      fullWidthById: { "page-1": false, "child-1": true },
    });
  });

  it("미게시 페이지는 clientPrefs 저장과 publishPage를 건너뛴다", async () => {
    getStatusMock.mockResolvedValueOnce(makeStatus(false));

    await expect(refreshPublishedLayoutSnapshot("page-1")).resolves.toBe(false);

    expect(flushMock).not.toHaveBeenCalled();
    expect(publishMock).not.toHaveBeenCalled();
  });
});
