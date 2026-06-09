import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePageStore } from "../../../store/pageStore";
import { useSettingsStore } from "../../../store/settingsStore";
import { useUiStore } from "../../../store/uiStore";
import { PageSubpageTree } from "../PageSubpageTree";

describe("PageSubpageTree", () => {
  beforeEach(() => {
    usePageStore.setState({
      pages: {
        row: {
          id: "row",
          workspaceId: "ws-1",
          title: "Row",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 0,
          createdAt: 1,
          updatedAt: 1,
          databaseId: "db-1",
        },
        child: {
          id: "child",
          workspaceId: "ws-1",
          title: "Child",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: "row",
          order: 0,
          createdAt: 1,
          updatedAt: 1,
        },
        grandchild: {
          id: "grandchild",
          workspaceId: "ws-1",
          title: "Grandchild",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: "child",
          order: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      },
      activePageId: "row",
    });
    useSettingsStore.setState({
      tabs: [{ pageId: "row", databaseId: null }],
      activeTabIndex: 0,
    });
    useUiStore.setState({
      databaseTreeFocusRequest: null,
    });
  });

  it("페이지 클릭 시 navigate와 DB focus request를 함께 남긴다", () => {
    const onNavigate = vi.fn();
    render(
      <PageSubpageTree
        currentPageId="grandchild"
        onNavigate={onNavigate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /grandchild/i }));

    expect(onNavigate).toHaveBeenCalledWith("grandchild");
    expect(useUiStore.getState().databaseTreeFocusRequest).toMatchObject({
      databaseId: "db-1",
      pageId: "grandchild",
    });
  });
});
