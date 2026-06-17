import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchPageById } from "../bootstrap";
import { ensurePageContentLoaded, shouldLoadPageContent } from "../pageContentLoad";
import {
  refreshWorkspaceSnapshot,
  workspaceHasStructureCache,
} from "../workspaceSwitch";
import { useWorkspaceStore } from "../../../store/workspaceStore";

vi.mock("../bootstrap", () => ({
  fetchPageById: vi.fn(),
}));

vi.mock("../storeApply", () => ({
  applyRemotePageToStore: vi.fn(),
}));

vi.mock("../workspaceSwitch", () => ({
  refreshWorkspaceSnapshot: vi.fn(),
  workspaceHasStructureCache: vi.fn(),
}));

const fetchPageByIdMock = vi.mocked(fetchPageById);
const refreshWorkspaceSnapshotMock = vi.mocked(refreshWorkspaceSnapshot);
const workspaceHasStructureCacheMock = vi.mocked(workspaceHasStructureCache);

beforeEach(() => {
  fetchPageByIdMock.mockReset();
  refreshWorkspaceSnapshotMock.mockReset();
  workspaceHasStructureCacheMock.mockReset();
  workspaceHasStructureCacheMock.mockReturnValue(false);
  // 같은 워크스페이스 본문 로드 시나리오 — 현재 워크스페이스를 ws-1 로 둬야
  // ensurePageContentLoaded 가 타 워크스페이스 우회 경로가 아닌 일반 적용 경로를 탄다.
  useWorkspaceStore.setState({ currentWorkspaceId: "ws-1" });
});

describe("pageContentLoad", () => {
  it("contentLoaded 플래그가 없는 빈 placeholder doc은 본문 로드 대상으로 본다", () => {
    expect(
      shouldLoadPageContent(
        {
          doc: {
            type: "doc",
            content: [{ type: "paragraph" }],
          },
        },
        false,
      ),
    ).toBe(true);
  });

  it("contentLoaded 플래그가 없어도 실제 본문이 있으면 로드 대상으로 보지 않는다", () => {
    expect(
      shouldLoadPageContent(
        {
          doc: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "본문" }],
              },
            ],
          },
        },
        false,
      ),
    ).toBe(false);
  });

  it("로컬 페이지가 없어도 workspaceId가 있으면 서버 본문 조회를 시도한다", async () => {
    fetchPageByIdMock.mockResolvedValueOnce(null);

    await ensurePageContentLoaded({
      pageId: "missing-page",
      workspaceId: "ws-1",
      source: "test",
    });

    expect(fetchPageByIdMock).toHaveBeenCalledWith("ws-1", "missing-page");
  });

  it("워크스페이스 구조 캐시가 미완료이면 본문 로드 후 snapshot 을 갱신하지 않는다", async () => {
    fetchPageByIdMock.mockResolvedValueOnce({
      id: "page-with-content",
      workspaceId: "ws-1",
      title: "본문",
      doc: { type: "doc", content: [{ type: "paragraph" }] },
      contentLoaded: true,
    } as never);

    await ensurePageContentLoaded({
      pageId: "page-with-content",
      workspaceId: "ws-1",
      source: "test",
    });

    expect(refreshWorkspaceSnapshotMock).not.toHaveBeenCalled();
  });

  it("워크스페이스 구조 캐시가 완료된 경우에만 본문 로드 후 snapshot 을 갱신한다", async () => {
    workspaceHasStructureCacheMock.mockReturnValue(true);
    fetchPageByIdMock.mockResolvedValueOnce({
      id: "page-with-structure",
      workspaceId: "ws-1",
      title: "본문",
      doc: { type: "doc", content: [{ type: "paragraph" }] },
      contentLoaded: true,
    } as never);

    await ensurePageContentLoaded({
      pageId: "page-with-structure",
      workspaceId: "ws-1",
      source: "test",
    });

    expect(refreshWorkspaceSnapshotMock).toHaveBeenCalledWith("ws-1");
  });
});
