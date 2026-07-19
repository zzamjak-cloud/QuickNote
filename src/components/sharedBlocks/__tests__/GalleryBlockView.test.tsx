import React, { type ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DropdownMenuBlockView, GalleryBlockView } from "../SharedBlockView";
import { useSharedBlockStore, sharedBlockRecordKey } from "../../../store/sharedBlockStore";
import { useWorkspaceStore } from "../../../store/workspaceStore";
import {
  emptyGallery,
  serializeSharedBlockData,
  type DropdownMenuData,
  type GalleryData,
  type SharedBlockRecord,
} from "../../../types/sharedBlock";

const mocks = vi.hoisted(() => ({
  fetchSharedBlockApi: vi.fn(),
  pushSharedBlockApi: vi.fn(),
  uploadImage: vi.fn(),
  prepareImageFileForUpload: vi.fn(),
  flushSharedBlockHostPageDoc: vi.fn(),
  useImageUrl: vi.fn(),
}));

vi.mock("@tiptap/react", () => ({
  NodeViewWrapper: ({ children, ...props }: { children: ReactNode }) => (
    <div {...props}>{children}</div>
  ),
}));

vi.mock("../../../lib/sync/sharedBlockApi", () => ({
  fetchSharedBlockApi: mocks.fetchSharedBlockApi,
  pushSharedBlockApi: mocks.pushSharedBlockApi,
}));

vi.mock("../../../lib/images/upload", () => ({
  uploadImage: mocks.uploadImage,
}));

vi.mock("../../../lib/images/compressImage", () => ({
  prepareImageFileForUpload: mocks.prepareImageFileForUpload,
}));

vi.mock("../../../lib/images/hooks", () => ({
  useImageUrl: mocks.useImageUrl,
}));

vi.mock("../sharedBlockHostPageFlush", () => ({
  flushSharedBlockHostPageDoc: mocks.flushSharedBlockHostPageDoc,
}));

function galleryData(src: string, alt = "배너"): GalleryData {
  return {
    kind: "gallery",
    images: [{ id: "image-1", src, alt }],
    intervalMs: 5000,
    heightPx: 320,
  };
}

function dropdownData(): DropdownMenuData {
  return {
    kind: "dropdown-menu",
    items: [
      {
        id: "item-1",
        label: "한국어",
        pageId: "page-1",
        pageLabel: "제품 소개",
      },
    ],
  };
}

function renderGallery(attrs?: Record<string, unknown>) {
  const Component = GalleryBlockView as unknown as React.ComponentType<{
    node: { attrs: Record<string, unknown> };
    selected: boolean;
    updateAttributes: (attrs: Record<string, unknown>) => void;
    editor: {
      isEditable: boolean;
      isDestroyed: boolean;
      storage: { pageContext: { pageId: string } };
      getJSON: () => unknown;
    };
  }>;
  const nodeAttrs = {
    sharedBlockId: "shared-gallery-1",
    data: serializeSharedBlockData(emptyGallery()),
    version: 1,
    publicMode: false,
    autoOpenEditor: false,
    align: "left",
    ...attrs,
  };
  const updateAttributes = vi.fn((next: Record<string, unknown>) => {
    Object.assign(nodeAttrs, next);
  });
  const editor = {
    isEditable: true,
    isDestroyed: false,
    storage: { pageContext: { pageId: "page-1" } },
    getJSON: vi.fn(() => ({
      type: "doc",
      content: [{ type: "galleryBlock", attrs: nodeAttrs }],
    })),
  };

  render(
    <Component
      node={{ attrs: nodeAttrs }}
      selected={false}
      updateAttributes={updateAttributes}
      editor={editor}
    />,
  );

  return { nodeAttrs, updateAttributes, editor };
}

function renderDropdown(attrs?: Record<string, unknown>) {
  const Component = DropdownMenuBlockView as unknown as React.ComponentType<{
    node: { attrs: Record<string, unknown> };
    selected: boolean;
    updateAttributes: (attrs: Record<string, unknown>) => void;
    editor: {
      isEditable: boolean;
      isDestroyed: boolean;
      storage: { pageContext: { pageId: string } };
      getJSON: () => unknown;
    };
  }>;
  const nodeAttrs = {
    sharedBlockId: "shared-dropdown-1",
    data: serializeSharedBlockData(dropdownData()),
    version: 1,
    publicMode: false,
    autoOpenEditor: false,
    align: "right",
    ...attrs,
  };
  const updateAttributes = vi.fn((next: Record<string, unknown>) => {
    Object.assign(nodeAttrs, next);
  });
  const editor = {
    isEditable: true,
    isDestroyed: false,
    storage: { pageContext: { pageId: "page-1" } },
    getJSON: vi.fn(() => ({
      type: "doc",
      content: [{ type: "dropdownMenuBlock", attrs: nodeAttrs }],
    })),
  };

  render(
    <Component
      node={{ attrs: nodeAttrs }}
      selected={false}
      updateAttributes={updateAttributes}
      editor={editor}
    />,
  );

  return { nodeAttrs, updateAttributes, editor };
}

describe("GalleryBlockView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    useWorkspaceStore.setState({ currentWorkspaceId: "workspace-1", workspaces: [] });
    useSharedBlockStore.setState({ records: {} });
    mocks.fetchSharedBlockApi.mockResolvedValue(null);
    mocks.prepareImageFileForUpload.mockImplementation(async (file: File) => file);
    mocks.useImageUrl.mockImplementation((src: string) => ({
      url: src,
      error: null,
      reportLoadError: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("페이지 JSON inline data 를 오래된 빈 seed 로 가리지 않는다", () => {
    const inline = galleryData("quicknote-image://inline-asset", "Hero");
    const staleSeed: SharedBlockRecord = {
      id: "shared-gallery-1",
      workspaceId: "workspace-1",
      kind: "gallery",
      data: emptyGallery(),
      updatedAt: 0,
      deletedAt: null,
    };
    useSharedBlockStore.setState({
      records: {
        [sharedBlockRecordKey("workspace-1", "shared-gallery-1")]: staleSeed,
      },
    });

    renderGallery({ data: serializeSharedBlockData(inline) });

    expect(screen.getByLabelText("Hero 미리보기")).toBeInTheDocument();
    expect(screen.queryByText("편집 버튼에서 배너 이미지를 추가하세요.")).not.toBeInTheDocument();
  });

  it("편집한 블록 높이를 공유 데이터에 저장하고 렌더링에 적용한다", async () => {
    const inline = { ...galleryData("quicknote-image://height-asset", "높이 배너"), heightPx: 420 };
    mocks.pushSharedBlockApi.mockImplementation(async (record: SharedBlockRecord) => record);
    const { updateAttributes } = renderGallery({ data: serializeSharedBlockData(inline) });

    expect(screen.getByRole("region", { name: "롤링 갤러리" })).toHaveStyle({ height: "420px" });
    expect(screen.getByAltText("높이 배너")).toHaveClass("object-contain");
    fireEvent.click(screen.getByLabelText("갤러리 편집"));
    fireEvent.change(screen.getByLabelText("갤러리 높이"), { target: { value: "560" } });
    expect(screen.getByText("560px")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "변경사항 저장" }));

    await waitFor(() => expect(mocks.pushSharedBlockApi).toHaveBeenCalledTimes(1));
    const saved = mocks.pushSharedBlockApi.mock.calls[0]?.[0] as SharedBlockRecord;
    expect(saved.data).toMatchObject({ kind: "gallery", heightPx: 560 });
    await waitFor(() => expect(updateAttributes).toHaveBeenCalledWith({
      data: expect.stringContaining('"heightPx":560'),
    }));
  });

  it("업로드한 이미지를 저장하면 SharedBlock 과 host page inline data 를 함께 갱신한다", async () => {
    mocks.uploadImage.mockResolvedValue("quicknote-image://uploaded-asset");
    mocks.pushSharedBlockApi.mockImplementation(async (record: SharedBlockRecord) => record);
    const { updateAttributes } = renderGallery();

    fireEvent.click(screen.getByLabelText("갤러리 편집"));
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();
    fireEvent.change(fileInput!, {
      target: {
        files: [new File(["image"], "uploaded.png", { type: "image/png" })],
      },
    });

    await screen.findByDisplayValue("uploaded");
    fireEvent.click(screen.getByRole("button", { name: "변경사항 저장" }));

    await waitFor(() => expect(mocks.pushSharedBlockApi).toHaveBeenCalledTimes(1));
    const saved = mocks.pushSharedBlockApi.mock.calls[0]?.[0] as SharedBlockRecord;
    expect(saved.data).toMatchObject({
      kind: "gallery",
      images: [{ src: "quicknote-image://uploaded-asset", alt: "uploaded" }],
    });
    await waitFor(() => expect(updateAttributes).toHaveBeenCalledWith({
      data: expect.stringContaining("quicknote-image://uploaded-asset"),
    }));
    expect(mocks.flushSharedBlockHostPageDoc).toHaveBeenCalled();
  });

  it("드롭다운 편집 버튼은 블록 우측이 아니라 열린 목록 상단에 표시한다", async () => {
    renderDropdown();

    expect(screen.queryByRole("button", { name: "편집" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("드롭다운 메뉴 편집")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /한국어/ }));

    const editButton = await screen.findByRole("button", { name: "편집" });
    expect(editButton).toHaveAttribute("title", "드롭다운 메뉴 편집");

    fireEvent.click(editButton);

    expect(await screen.findByRole("dialog", { name: "드롭다운 메뉴 편집" })).toBeInTheDocument();
  });
});
