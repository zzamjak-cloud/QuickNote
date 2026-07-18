import type { Editor } from "@tiptap/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushSharedBlockHostPageDoc } from "../sharedBlockHostPageFlush";

const mocks = vi.hoisted(() => ({
  enqueuePageUpsertForSync: vi.fn(),
  updateDoc: vi.fn(),
  pages: {} as Record<string, unknown>,
}));

vi.mock("../../../store/pageStore", () => ({
  enqueuePageUpsertForSync: mocks.enqueuePageUpsertForSync,
  usePageStore: {
    getState: () => ({
      updateDoc: mocks.updateDoc,
      pages: mocks.pages,
    }),
  },
}));

function editorStub(pageId: string | null, doc: unknown, destroyed = false): Editor {
  return {
    storage: { pageContext: { pageId } },
    isDestroyed: destroyed,
    getJSON: vi.fn(() => doc),
  } as unknown as Editor;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
}

describe("flushSharedBlockHostPageDoc", () => {
  beforeEach(() => {
    mocks.enqueuePageUpsertForSync.mockReset();
    mocks.updateDoc.mockReset();
    mocks.pages = {};
  });

  it("공유 블록 attrs 변경 직후 호스트 페이지 doc 을 즉시 동기화 큐에 싣는다", async () => {
    const doc = {
      type: "doc",
      content: [{ type: "galleryBlock", attrs: { sharedBlockId: "shared-1" } }],
    };
    const page = { id: "page-1", doc };
    mocks.pages = { "page-1": page };

    flushSharedBlockHostPageDoc(editorStub("page-1", doc));
    await flushMicrotasks();

    expect(mocks.updateDoc).toHaveBeenCalledWith("page-1", doc, { deferSync: true });
    expect(mocks.enqueuePageUpsertForSync).toHaveBeenCalledWith(page);
  });

  it("호스트 페이지 id 가 없거나 에디터가 폐기됐으면 저장하지 않는다", async () => {
    flushSharedBlockHostPageDoc(editorStub(null, { type: "doc" }));
    flushSharedBlockHostPageDoc(editorStub("page-1", { type: "doc" }, true));
    await flushMicrotasks();

    expect(mocks.updateDoc).not.toHaveBeenCalled();
    expect(mocks.enqueuePageUpsertForSync).not.toHaveBeenCalled();
  });
});
