import React, { type ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GalleryBlockView } from "../SharedBlockView";
import { useSharedBlockStore, sharedBlockRecordKey } from "../../../store/sharedBlockStore";
import { useWorkspaceStore } from "../../../store/workspaceStore";
import { emptyGallery, serializeSharedBlockData, type GalleryData, type SharedBlockRecord } from "../../../types/sharedBlock";

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

describe("GalleryBlockView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
