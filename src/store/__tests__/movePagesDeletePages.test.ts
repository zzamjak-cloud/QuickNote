// 사이드바 멀티 선택 일괄 이동(movePages)·일괄 삭제(deletePages) 회귀 테스트.
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
    doc: { type: "doc", content: [{ type: "paragraph" }] },
    parentId: null,
    order,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...partial,
  };
}

async function setupStore() {
  const { useWorkspaceStore } = await import("../workspaceStore");
  const { usePageStore } = await import("../pageStore");
  useWorkspaceStore.setState({ currentWorkspaceId: "ws-1", workspaces: [] });
  usePageStore.setState({
    pages: {
      a: page("a", 0),
      a1: page("a1", 0, { parentId: "a" }),
      b: page("b", 1),
      c: page("c", 2),
      d: page("d", 3),
    },
    activePageId: null,
    cacheWorkspaceId: "ws-1",
    lastDeletedBatch: null,
  });
  return usePageStore;
}

describe("pageStore movePages (일괄 이동)", () => {
  beforeEach(() => {
    enqueueAsync.mockClear();
  });

  it("여러 페이지를 ids 순서 그대로 같은 위치에 연속 삽입한다", async () => {
    const usePageStore = await setupStore();
    // c, d 를 루트 맨 앞으로
    usePageStore.getState().movePages(["c", "d"], null, 0);
    const pages = usePageStore.getState().pages;
    const roots = Object.values(pages)
      .filter((p) => p.parentId === null)
      .sort((x, y) => x.order - y.order)
      .map((p) => p.id);
    expect(roots).toEqual(["c", "d", "a", "b"]);
  });

  it("다른 페이지의 자식으로 일괄 이동한다", async () => {
    const usePageStore = await setupStore();
    usePageStore.getState().movePages(["b", "c"], "a", Number.MAX_SAFE_INTEGER);
    const pages = usePageStore.getState().pages;
    const children = Object.values(pages)
      .filter((p) => p.parentId === "a")
      .sort((x, y) => x.order - y.order)
      .map((p) => p.id);
    expect(children).toEqual(["a1", "b", "c"]);
    // 루트 order 재조정 확인
    const roots = Object.values(pages)
      .filter((p) => p.parentId === null)
      .sort((x, y) => x.order - y.order)
      .map((p) => p.id);
    expect(roots).toEqual(["a", "d"]);
  });

  it("조상이 함께 선택된 자손은 제외한다(서브트리로 따라감)", async () => {
    const usePageStore = await setupStore();
    usePageStore.getState().movePages(["a", "a1"], "d", 0);
    const pages = usePageStore.getState().pages;
    expect(pages.a?.parentId).toBe("d");
    // a1 은 a 의 자식 그대로 유지
    expect(pages.a1?.parentId).toBe("a");
  });

  it("자기 자손 아래로의 이동(순환)은 무시한다", async () => {
    const usePageStore = await setupStore();
    usePageStore.getState().movePages(["a"], "a1", 0);
    expect(usePageStore.getState().pages.a?.parentId).toBeNull();
  });

  it("이동 변경분을 meta-only 로 enqueue 한다", async () => {
    const usePageStore = await setupStore();
    usePageStore.getState().movePages(["c", "d"], "b", 0);
    expect(enqueueAsync).toHaveBeenCalled();
    for (const [op, payload] of enqueueAsync.mock.calls) {
      expect(op).toBe("upsertPage");
      expect(payload).toMatchObject({ __metaOnly: true });
    }
  });
});

describe("pageStore deletePages (일괄 삭제)", () => {
  beforeEach(() => {
    enqueueAsync.mockClear();
  });

  it("여러 페이지를 자손 포함 삭제하고 undo 배치를 하나로 합친다", async () => {
    const usePageStore = await setupStore();
    usePageStore.getState().deletePages(["a", "c"]);
    const s = usePageStore.getState();
    expect(s.pages.a).toBeUndefined();
    expect(s.pages.a1).toBeUndefined(); // 자손 포함
    expect(s.pages.c).toBeUndefined();
    expect(s.pages.b).toBeDefined();
    // 배치가 하나로 합쳐져 undo 한 번에 전부 복원
    const restored = usePageStore.getState().undoLastDelete();
    expect(restored).toBe(true);
    const after = usePageStore.getState().pages;
    expect(after.a).toBeDefined();
    expect(after.a1).toBeDefined();
    expect(after.c).toBeDefined();
  });

  it("조상이 함께 선택된 자손 id 는 중복 삭제하지 않는다", async () => {
    const usePageStore = await setupStore();
    usePageStore.getState().deletePages(["a", "a1"]);
    const batch = usePageStore.getState().lastDeletedBatch;
    // a 서브트리(a, a1)만 — a1 이 두 번 들어가지 않는다
    expect(batch?.pages.map((p) => p.id).sort()).toEqual(["a", "a1"]);
  });
});
