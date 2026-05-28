import { fireEvent, render, screen } from "@testing-library/react";
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
});
