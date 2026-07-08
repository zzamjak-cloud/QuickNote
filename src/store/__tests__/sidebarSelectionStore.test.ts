// 사이드바 Shift+클릭 범위 선택 — 가시 순서(펼침 상태 반영) 기준 검증.
import { beforeEach, describe, expect, it } from "vitest";
import type { Page } from "../../types/page";

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

async function setup(expandedIds: string[]) {
  const { useWorkspaceStore } = await import("../workspaceStore");
  const { usePageStore } = await import("../pageStore");
  const { useSettingsStore } = await import("../settingsStore");
  const { useSidebarSelectionStore } = await import("../sidebarSelectionStore");
  useWorkspaceStore.setState({ currentWorkspaceId: "ws-1", workspaces: [] });
  usePageStore.setState({
    pages: {
      a: page("a", 0),
      a1: page("a1", 0, { parentId: "a" }),
      b: page("b", 1),
      c: page("c", 2),
    },
    activePageId: null,
    cacheWorkspaceId: "ws-1",
  });
  useSettingsStore.setState({ expandedIds });
  useSidebarSelectionStore.setState({ selectedIds: new Set(), anchorId: null });
  return useSidebarSelectionStore;
}

describe("sidebarSelectionStore", () => {
  beforeEach(async () => {
    // 각 테스트가 setup 으로 상태를 재설정한다.
  });

  it("앵커~대상 사이(접힌 자식 제외)를 모두 선택한다", async () => {
    const store = await setup([]);
    store.getState().beginAt("a");
    store.getState().shiftSelectTo("c");
    expect(Array.from(store.getState().selectedIds).sort()).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("펼쳐진 자식은 범위에 포함된다", async () => {
    const store = await setup(["a"]);
    store.getState().beginAt("a");
    store.getState().shiftSelectTo("b");
    expect(Array.from(store.getState().selectedIds).sort()).toEqual([
      "a",
      "a1",
      "b",
    ]);
  });

  it("역방향(아래→위) 선택도 동작한다", async () => {
    const store = await setup([]);
    store.getState().beginAt("c");
    store.getState().shiftSelectTo("a");
    expect(Array.from(store.getState().selectedIds).sort()).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("일반 클릭(beginAt)은 선택을 해제하고 앵커만 남긴다", async () => {
    const store = await setup([]);
    store.getState().beginAt("a");
    store.getState().shiftSelectTo("c");
    store.getState().beginAt("b");
    expect(store.getState().selectedIds.size).toBe(0);
    expect(store.getState().anchorId).toBe("b");
  });

  it("앵커가 없으면 활성 페이지를 앵커로 폴백한다", async () => {
    const store = await setup([]);
    const { usePageStore } = await import("../pageStore");
    usePageStore.setState({ activePageId: "b" });
    store.getState().shiftSelectTo("c");
    expect(Array.from(store.getState().selectedIds).sort()).toEqual(["b", "c"]);
  });
});
