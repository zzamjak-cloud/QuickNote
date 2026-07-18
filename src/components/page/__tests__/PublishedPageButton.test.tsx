import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPagePublishStatusApi, publishPageApi, unpublishPageApi } from "../../../lib/sync/publishApi";
import { usePagePublishStatusStore } from "../../../store/pagePublishStatusStore";
import { PublishDialog } from "../../layout/PublishDialog";
import { PageTitleBar } from "../PageTitleBar";
import { PublishedPageButton } from "../PublishedPageButton";

vi.mock("../../../lib/sync/publishApi", () => ({
  buildPublicPageUrl: (token: string) => `https://example.com/p/${token}`,
  getPagePublishStatusApi: vi.fn(),
  publishPageApi: vi.fn(),
  unpublishPageApi: vi.fn(),
}));

vi.mock("../../common/IconPicker", () => ({
  IconPicker: () => <span data-testid="icon-picker" />,
}));

const settingsState = vi.hoisted(() => ({
  favoritePageIds: [] as string[],
  toggleFavoritePage: vi.fn(),
}));

vi.mock("../../../store/settingsStore", () => ({
  useSettingsStore: (
    selector: (state: typeof settingsState) => unknown,
  ) => selector(settingsState),
}));

const getStatusMock = vi.mocked(getPagePublishStatusApi);
const publishMock = vi.mocked(publishPageApi);
const unpublishMock = vi.mocked(unpublishPageApi);

function makeStatus(published: boolean) {
  return {
    pageId: "page-1",
    workspaceId: "ws-1",
    published,
    token: published ? "token-1" : null,
    publishedAt: published ? "2026-07-18T00:00:00.000Z" : null,
  };
}

describe("PublishedPageButton", () => {
  beforeEach(() => {
    getStatusMock.mockReset();
    publishMock.mockReset();
    unpublishMock.mockReset();
    usePagePublishStatusStore.setState({ statusByPageId: {} });
  });

  it("게시된 페이지에서 표시되고 클릭하면 설정 열기 콜백을 실행한다", async () => {
    getStatusMock.mockResolvedValue(makeStatus(true));
    const onOpen = vi.fn();

    render(<PublishedPageButton pageId="page-1" onOpen={onOpen} />);

    const button = await screen.findByRole("button", {
      name: "웹 게시 설정 열기",
    });
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("미게시 또는 상태 조회 오류이면 버튼을 숨긴다", async () => {
    getStatusMock.mockResolvedValueOnce(makeStatus(false));
    const { unmount } = render(
      <PublishedPageButton pageId="page-1" onOpen={vi.fn()} />,
    );

    await waitFor(() => {
      expect(
        usePagePublishStatusStore.getState().statusByPageId["page-1"]
          ?.published,
      ).toBe(false);
    });
    expect(
      screen.queryByRole("button", { name: "웹 게시 설정 열기" }),
    ).toBeNull();

    unmount();
    usePagePublishStatusStore.setState({ statusByPageId: {} });
    getStatusMock.mockRejectedValueOnce(new Error("network"));
    render(<PublishedPageButton pageId="page-1" onOpen={vi.fn()} />);

    await waitFor(() => {
      expect(
        usePagePublishStatusStore.getState().statusByPageId["page-1"]
          ?.published,
      ).toBe(false);
    });
    expect(
      screen.queryByRole("button", { name: "웹 게시 설정 열기" }),
    ).toBeNull();
  });

  it("게시 다이얼로그의 게시·해제 결과를 즉시 반영한다", async () => {
    getStatusMock.mockResolvedValue(makeStatus(false));
    publishMock.mockResolvedValue(makeStatus(true));
    unpublishMock.mockResolvedValue(makeStatus(false));

    render(
      <>
        <PublishedPageButton pageId="page-1" onOpen={vi.fn()} />
        <PublishDialog pageId="page-1" onClose={vi.fn()} />
      </>,
    );

    const publishButton = await screen.findByRole("button", { name: "게시" });
    fireEvent.click(publishButton);

    await screen.findByRole("button", { name: "웹 게시 설정 열기" });
    const unpublishButton = await screen.findByRole("button", {
      name: "게시 해제",
    });
    fireEvent.click(unpublishButton);

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "웹 게시 설정 열기" }),
      ).toBeNull();
    });
  });

  it("빠른 진입 prop이 없는 제목줄에는 게시 버튼을 만들지 않는다", () => {
    act(() => {
      usePagePublishStatusStore.getState().setPublished("page-1", true);
    });

    render(
      <PageTitleBar
        pageId="page-1"
        icon={null}
        titleDraft="DB row"
        onTitleChange={vi.fn()}
        onTitleBlur={vi.fn()}
        onIconChange={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "웹 게시 설정 열기" }),
    ).toBeNull();
    expect(getStatusMock).not.toHaveBeenCalled();
  });

  it("제목줄에서 댓글, 웹 게시, 즐겨찾기 순서로 버튼을 배치한다", async () => {
    getStatusMock.mockResolvedValue(makeStatus(true));

    render(
      <PageTitleBar
        pageId="page-1"
        icon={null}
        titleDraft="Published page"
        onTitleChange={vi.fn()}
        onTitleBlur={vi.fn()}
        onIconChange={vi.fn()}
        onAddComment={vi.fn()}
        onOpenPublishSettings={vi.fn()}
      />,
    );

    await screen.findByRole("button", { name: "웹 게시 설정 열기" });
    expect(
      screen
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["댓글 추가", "웹 게시 설정 열기", "즐겨찾기"]);
  });
});
