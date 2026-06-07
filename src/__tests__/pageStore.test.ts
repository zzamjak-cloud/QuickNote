import { describe, it, expect, beforeEach, vi } from "vitest";
import { usePageStore, selectSortedPages, selectPageTree } from "../store/pageStore";
import { useSettingsStore } from "../store/settingsStore";

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

describe("settingsStore", () => {
  it("toggleFullWidth이 fullWidth를 토글한다", () => {
    useSettingsStore.setState({ fullWidth: false });
    const store = useSettingsStore.getState();
    expect(store.fullWidth).toBe(false);
    store.toggleFullWidth();
    expect(useSettingsStore.getState().fullWidth).toBe(true);
    store.toggleFullWidth();
    expect(useSettingsStore.getState().fullWidth).toBe(false);
  });
});

describe("pageStore - duplicatePage", () => {
  beforeEach(() => {
    usePageStore.setState({ pages: {}, activePageId: null });
  });

  it("페이지를 복제하면 원본 바로 다음에 삽입된다", () => {
    const store = usePageStore.getState();
    const id = store.createPage("원본");
    usePageStore.getState().duplicatePage(id);
    const pages = Object.values(usePageStore.getState().pages);
    expect(pages).toHaveLength(2);
    const copy = pages.find((p) => p.id !== id);
    expect(copy?.title).toBe("원본 (Copy)");
    expect(copy?.parentId).toBe(null);
  });

  it("자식 페이지도 함께 복제된다", () => {
    const store = usePageStore.getState();
    const parentId = store.createPage("부모");
    usePageStore.getState().createPage("자식", parentId);
    usePageStore.getState().duplicatePage(parentId);
    const pages = Object.values(usePageStore.getState().pages);
    expect(pages).toHaveLength(4);
  });

  it("복제 후 원본 doc 변경이 사본 doc와 분리된다", () => {
    const id = usePageStore.getState().createPage("원본");
    usePageStore.getState().updateDoc(id, {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }],
    });
    const copyId = usePageStore.getState().duplicatePage(id);
    expect(copyId).not.toBe("");

    usePageStore.getState().updateDoc(id, {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "B" }] }],
    });

    const origDoc = usePageStore.getState().pages[id]!.doc;
    const copyDoc = usePageStore.getState().pages[copyId]!.doc;
    expect(JSON.stringify(origDoc)).toContain("B");
    expect(JSON.stringify(copyDoc)).toContain("A");
  });
});

describe("pageStore — DB 행 페이지 가시성", () => {
  beforeEach(() => {
    usePageStore.setState({ pages: {}, activePageId: null });
  });

  it("databaseId가 있는 페이지는 selectPageTree에서 제외된다", () => {
    const normal = usePageStore.getState().createPage("일반", null, { activate: false });
    const row = usePageStore.getState().createPage("행", null, { activate: false });
    usePageStore.setState((s) => ({
      pages: {
        ...s.pages,
        [row]: { ...s.pages[row]!, databaseId: "db-1", dbCells: {} },
      },
    }));

    const tree = selectPageTree(usePageStore.getState());
    expect(tree.map((p) => p.id)).toEqual([normal]);
  });

  it("selectSortedPages에서도 동일하게 제외된다", () => {
    const normal = usePageStore.getState().createPage("일반", null, { activate: false });
    const row = usePageStore.getState().createPage("행", null, { activate: false });
    usePageStore.setState((s) => ({
      pages: {
        ...s.pages,
        [row]: { ...s.pages[row]!, databaseId: "db-1" },
      },
    }));

    const sorted = selectSortedPages(usePageStore.getState());
    expect(sorted.map((p) => p.id)).toEqual([normal]);
  });

  it("setPageDbCell이 dbCells를 갱신한다", () => {
    const id = usePageStore.getState().createPage("p", null, { activate: false });
    usePageStore.setState((s) => ({
      pages: { ...s.pages, [id]: { ...s.pages[id]!, databaseId: "db-1", dbCells: {} } },
    }));
    usePageStore.getState().setPageDbCell(id, "col-1", "값1");
    expect(usePageStore.getState().pages[id]?.dbCells?.["col-1"]).toBe("값1");
  });

  it("ensureFullPagePageForDatabase는 사이드바에 숨겨지는 fullPage 홈 문서를 만든다", () => {
    const id = usePageStore
      .getState()
      .ensureFullPagePageForDatabase("db-1", "작업 DB", "kanban");
    expect(id).toBeTruthy();

    const state = usePageStore.getState();
    const page = state.pages[id!];
    expect(page?.title).toBe("작업 DB");
    expect(page?.databaseId).toBeUndefined();
    expect(page?.parentId).toBe(null);
    expect(page?.doc.content?.[0]?.attrs).toMatchObject({
      databaseId: "db-1",
      layout: "fullPage",
      view: "kanban",
    });
    expect(state.activePageId).toBe(null);
    expect(state.findFullPagePageIdForDatabase("db-1")).toBe(id);
    expect(selectSortedPages(state).map((p) => p.id)).toEqual([]);
  });

  it("ensureFullPagePageForDatabase는 기존 fullPage 홈 문서를 재사용한다", () => {
    const first = usePageStore
      .getState()
      .ensureFullPagePageForDatabase("db-1", "작업 DB", "table");
    const second = usePageStore
      .getState()
      .ensureFullPagePageForDatabase("db-1", "다른 이름", "gallery");

    expect(second).toBe(first);
    expect(Object.keys(usePageStore.getState().pages)).toHaveLength(1);
  });

  it("ensureFullPagePageForDatabase는 LC 보호 DB 홈 페이지를 만들지 않는다", () => {
    const id = usePageStore
      .getState()
      .ensureFullPagePageForDatabase(
        "lc-scheduler-db:lc-scheduler-global",
        "LC스케줄러",
        "table",
      );

    expect(id).toBeNull();
    expect(usePageStore.getState().pages).toEqual({});
  });

  it("fullPage 홈 문서 삭제 시 같은 DB 탭을 해제해 즉시 재생성을 막는다", () => {
    const fallbackPageId = usePageStore
      .getState()
      .createPage("일반", null, { activate: false });
    const homePageId = usePageStore
      .getState()
      .ensureFullPagePageForDatabase("db-1", "작업 DB", "table");
    expect(homePageId).toBeTruthy();
    usePageStore.getState().setActivePage(fallbackPageId);
    useSettingsStore.setState({
      tabs: [{ pageId: null, databaseId: "db-1" }],
      activeTabIndex: 0,
    });

    usePageStore.getState().deletePage(homePageId!);

    expect(usePageStore.getState().pages[homePageId!]).toBeUndefined();
    expect(useSettingsStore.getState().tabs[0]).toMatchObject({
      pageId: fallbackPageId,
      databaseId: null,
    });
  });
});
