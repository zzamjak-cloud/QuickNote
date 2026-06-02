import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PageNode } from "../../../store/pageStore";
import { usePageStore } from "../../../store/pageStore";
import { useSettingsStore } from "../../../store/settingsStore";
import { PageListItem } from "../PageListItem";

vi.mock("@dnd-kit/core", () => ({
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    isDragging: false,
  }),
  useDroppable: () => ({
    setNodeRef: vi.fn(),
  }),
}));

function makeNode(id: string, title: string): PageNode {
  return {
    id,
    title,
    icon: null,
    doc: { type: "doc", content: [] },
    parentId: null,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    children: [],
  };
}

describe("PageListItem", () => {
  beforeEach(() => {
    usePageStore.setState({
      pages: {
        "page-1": makeNode("page-1", "문서 1"),
      },
      activePageId: null,
    });
    useSettingsStore.setState({
      tabs: [{ pageId: null, databaseId: "db-1" }],
      activeTabIndex: 0,
      expandedIds: [],
    });
  });

  it("DB 원본 탭 상태에서도 사이드바 페이지 클릭 시 현재 탭을 페이지로 전환한다", () => {
    render(
      <PageListItem
        node={makeNode("page-1", "문서 1")}
        depth={0}
        draggable={false}
        onMove={() => {}}
        dropTarget={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "문서 1" }));

    expect(usePageStore.getState().activePageId).toBe("page-1");
    expect(useSettingsStore.getState().tabs[0]).toMatchObject({
      pageId: "page-1",
      databaseId: null,
    });
  });

  it("우클릭 메뉴에서 이름 변경과 하위 페이지 추가를 숨기고 페이지 복제를 제공한다", () => {
    render(
      <PageListItem
        node={makeNode("page-1", "문서 1")}
        depth={0}
        draggable={false}
        onMove={() => {}}
        dropTarget={null}
      />,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: "문서 1" }));

    const menu = screen.getByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: "이름 변경" })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: "하위 페이지 추가" })).toBeNull();

    const historyButton = within(menu).getByRole("menuitem", { name: "버전 히스토리" });
    expect(historyButton.querySelector("svg")).not.toBeNull();

    fireEvent.click(within(menu).getByRole("menuitem", { name: "페이지 복제" }));

    const copy = Object.values(usePageStore.getState().pages).find((page) => page.id !== "page-1");
    expect(copy).toMatchObject({
      title: "문서 1 (Copy)",
      parentId: null,
    });
    expect(usePageStore.getState().activePageId).toBe(copy?.id);
    expect(useSettingsStore.getState().tabs[0]).toMatchObject({
      pageId: copy?.id,
      databaseId: null,
    });
  });
});
