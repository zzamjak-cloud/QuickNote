import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JSONContent } from "@tiptap/react";
import { emptyPanelState, type ColumnDef } from "../../../../types/database";
import type { Page } from "../../../../types/page";
import { useDatabaseStore } from "../../../../store/databaseStore";
import { usePageStore } from "../../../../store/pageStore";
import { useWorkspaceStore } from "../../../../store/workspaceStore";
import { ensurePageContentLoaded } from "../../../../lib/sync/pageContentLoad";
import { DatabaseGalleryView } from "../DatabaseGalleryView";

vi.mock("../../DatabaseCell", () => ({
  DatabaseCell: () => <span data-testid="database-cell" />,
}));

vi.mock("../../../common/IconPicker", () => ({
  IconPicker: () => <span data-testid="icon-picker" />,
}));

vi.mock("../../../../lib/images/hooks", () => ({
  useImageUrl: (src: string | null | undefined) => ({
    url: src ? `resolved:${src}` : null,
    error: null,
  }),
}));

vi.mock("../../../../lib/sync/pageContentLoad", () => ({
  ensurePageContentLoaded: vi.fn(async () => true),
}));

const ensurePageContentLoadedMock = vi.mocked(ensurePageContentLoaded);
const titleColumn: ColumnDef = { id: "title", name: "제목", type: "title" };
const urlColumn: ColumnDef = { id: "url", name: "URL", type: "url" };

function imageDoc(...srcs: string[]): JSONContent {
  return {
    type: "doc",
    content: srcs.map((src) => ({ type: "image", attrs: { src } })),
  };
}

function seedGallery({
  columns = [titleColumn],
  page,
}: {
  columns?: ColumnDef[];
  page: Page;
}) {
  useDatabaseStore.setState({
    databases: {
      "db-1": {
        meta: { id: "db-1", title: "DB", createdAt: 1, updatedAt: 1 },
        columns,
        rowPageOrder: [page.id],
      },
    },
    cacheWorkspaceId: "ws-1",
  });
  usePageStore.setState({
    pages: { [page.id]: page },
    activePageId: null,
  });
}

function rowPage(input: Partial<Page> = {}): Page {
  return {
    id: "row-1",
    workspaceId: "ws-1",
    title: "행 1",
    icon: null,
    doc: { type: "doc", content: [] },
    parentId: null,
    order: 1,
    createdAt: 1,
    updatedAt: 1,
    databaseId: "db-1",
    ...input,
  };
}

function renderGallery() {
  return render(
    <DatabaseGalleryView
      databaseId="db-1"
      panelState={{ ...emptyPanelState(), galleryColumns: 1 }}
      setPanelState={vi.fn()}
    />,
  );
}

describe("DatabaseGalleryView cover", () => {
  beforeEach(() => {
    ensurePageContentLoadedMock.mockClear();
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-1" });
    useDatabaseStore.setState({ databases: {}, cacheWorkspaceId: null });
    usePageStore.setState({ pages: {}, activePageId: null });
  });

  it("본문 이미지가 없으면 갤러리 카드에서 행 본문 로드를 요청한다", async () => {
    seedGallery({ page: rowPage({ contentLoaded: false }) });

    renderGallery();

    await waitFor(() => {
      expect(ensurePageContentLoadedMock).toHaveBeenCalledWith({
        pageId: "row-1",
        workspaceId: "ws-1",
        source: "database-gallery-cover-preview",
      });
    });
  });

  it("커버 선택기에서 quicknote 이미지 ref를 표시 URL로 풀어 썸네일을 렌더한다", () => {
    seedGallery({
      page: rowPage({
        doc: imageDoc("quicknote-image://img-1", "https://example.com/photo.png"),
        contentLoaded: true,
      }),
    });

    renderGallery();
    fireEvent.click(screen.getByTitle("커버 이미지 설정"));

    expect(document.querySelector('img[src="resolved:quicknote-image://img-1"]')).not.toBeNull();
    expect(document.querySelector('img[src="resolved:https://example.com/photo.png"]')).not.toBeNull();
  });

  it("URL 커버가 이미지로 로드되지 않으면 본문 첫 이미지로 fallback한다", async () => {
    seedGallery({
      columns: [titleColumn, urlColumn],
      page: rowPage({
        dbCells: { url: "https://example.com/not-image" },
        doc: imageDoc("quicknote-image://body-cover"),
        contentLoaded: true,
      }),
    });

    const { container } = renderGallery();
    const cover = container.querySelector('img[src="resolved:https://example.com/not-image"]');
    expect(cover).not.toBeNull();

    fireEvent.error(cover as HTMLImageElement);

    await waitFor(() => {
      expect(container.querySelector('img[src="resolved:quicknote-image://body-cover"]')).not.toBeNull();
    });
  });
});
