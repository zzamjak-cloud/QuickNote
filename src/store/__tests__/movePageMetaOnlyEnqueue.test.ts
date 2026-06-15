import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Page } from "../../types/page";

const enqueueAsync = vi.fn();
vi.mock("../../lib/sync/runtime", () => ({
  enqueueAsync: (...args: unknown[]) => enqueueAsync(...args),
}));

function page(id: string, order: number, partial: Partial<Page> = {}): Page {
  return {
    id,
    workspaceId: "ws-1",
    title: id,
    icon: null,
    doc: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "큰 본문" }] }],
    },
    parentId: null,
    order,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...partial,
  };
}

describe("pageStore movePage sync enqueue", () => {
  beforeEach(async () => {
    enqueueAsync.mockClear();
    const { useWorkspaceStore } = await import("../workspaceStore");
    const { usePageStore } = await import("../pageStore");
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-1", workspaces: [] });
    usePageStore.setState({
      pages: {
        a: page("a", 0),
        b: page("b", 1),
        c: page("c", 2),
      },
      activePageId: null,
      cacheWorkspaceId: "ws-1",
    });
  });

  it("사이드바 이동은 본문 대신 meta-only placeholder payload를 enqueue한다", async () => {
    const { usePageStore } = await import("../pageStore");

    usePageStore.getState().movePage("c", null, 0);

    expect(enqueueAsync).toHaveBeenCalled();
    for (const [op, payload] of enqueueAsync.mock.calls) {
      expect(op).toBe("upsertPage");
      expect(payload).toMatchObject({
        __metaOnly: true,
        workspaceId: "ws-1",
      });
      expect(payload.doc).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
      expect(payload).not.toHaveProperty("dbCells");
    }
  });
});
