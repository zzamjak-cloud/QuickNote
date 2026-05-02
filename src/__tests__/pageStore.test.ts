import { describe, it, expect, beforeEach } from "vitest";
import { usePageStore, selectSortedPages } from "../store/pageStore";

beforeEach(() => {
  localStorage.clear();
  usePageStore.setState({ pages: {}, activePageId: null });
});

describe("pageStore", () => {
  it("createPage: 페이지를 추가하고 활성화", () => {
    const id = usePageStore.getState().createPage("첫 페이지");
    const state = usePageStore.getState();
    expect(state.pages[id]?.title).toBe("첫 페이지");
    expect(state.activePageId).toBe(id);
  });

  it("renamePage: 제목과 updatedAt 갱신", () => {
    const id = usePageStore.getState().createPage("a");
    const before = usePageStore.getState().pages[id]!.updatedAt;
    // updatedAt 변화 보장을 위해 한 틱 대기 시뮬레이션
    const tomorrow = before + 1000;
    vi.useFakeTimers().setSystemTime(tomorrow);
    usePageStore.getState().renamePage(id, "b");
    const after = usePageStore.getState().pages[id]!;
    expect(after.title).toBe("b");
    expect(after.updatedAt).toBe(tomorrow);
    vi.useRealTimers();
  });

  it("deletePage: 활성 페이지 삭제 시 다음 페이지로 전환", () => {
    const a = usePageStore.getState().createPage("a");
    const b = usePageStore.getState().createPage("b");
    usePageStore.getState().setActivePage(a);
    usePageStore.getState().deletePage(a);
    const state = usePageStore.getState();
    expect(state.pages[a]).toBeUndefined();
    expect(state.activePageId).toBe(b);
  });

  it("reorderPages: order 필드 재할당", () => {
    const a = usePageStore.getState().createPage("a");
    const b = usePageStore.getState().createPage("b");
    const c = usePageStore.getState().createPage("c");
    usePageStore.getState().reorderPages([c, a, b]);
    const sorted = selectSortedPages(usePageStore.getState()).map((p) => p.id);
    expect(sorted).toEqual([c, a, b]);
  });
});
