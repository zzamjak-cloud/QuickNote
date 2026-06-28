import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDatabaseStore } from "../../../store/databaseStore";
import { usePageStore } from "../../../store/pageStore";
import { useSettingsStore } from "../../../store/settingsStore";
import { useUiStore } from "../../../store/uiStore";
import type { DatabaseBundle } from "../../../types/database";
import type { Page } from "../../../types/page";
import { DatabaseRowPeek } from "../DatabaseRowPeek";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, "ResizeObserver", {
  value: ResizeObserverMock,
  writable: true,
  configurable: true,
});

vi.mock("../../editor/Editor", () => ({
  Editor: () => <div data-testid="peek-editor" />,
}));

vi.mock("../../page/PageTitleBar", () => ({
  PageTitleBar: () => <div data-testid="peek-title-bar" />,
}));

vi.mock("../../page/DbPropertySection", () => ({
  DbPropertySection: () => <div data-testid="peek-db-property-section" />,
}));

vi.mock("../../comments/PageCommentBar", () => ({
  PageCommentBar: () => <div data-testid="peek-page-comment-bar" />,
}));

vi.mock("../../common/ScrollToTopButton", () => ({
  ScrollToTopButton: () => null,
}));

vi.mock("../../layout/PageCopyToWorkspaceDialog", () => ({
  PageCopyToWorkspaceDialog: () => null,
}));

vi.mock("../../layout/PageMoveDialog", () => ({
  PageMoveDialog: () => null,
}));

const rowPage: Page = {
  id: "row-1",
  title: "행 1",
  icon: null,
  doc: { type: "doc", content: [] },
  parentId: null,
  order: 0,
  createdAt: 1,
  updatedAt: 1,
  databaseId: "db-1",
};

const bundle: DatabaseBundle = {
  meta: {
    id: "db-1",
    title: "작업 DB",
    createdAt: 1,
    updatedAt: 1,
  },
  columns: [{ id: "title", name: "제목", type: "title" }],
  rowPageOrder: ["row-1"],
};

describe("DatabaseRowPeek", () => {
  beforeEach(() => {
    usePageStore.setState({
      pages: { "row-1": rowPage },
      activePageId: "host-page",
    });
    useDatabaseStore.setState({ databases: { "db-1": bundle } });
    useSettingsStore.setState({
      fullWidth: false,
      pageFullWidthById: {},
    });
    useUiStore.setState({
      peekPageId: "row-1",
      peekHistory: [],
    });
  });

  it("속성 패널 영역도 피커뷰 전체 너비 설정을 따른다", () => {
    const { rerender } = render(<DatabaseRowPeek />);
    const propertySection = screen.getByTestId("peek-db-property-section");
    // 모바일에선 패딩 0, 데스크톱(md+)에서 px-12 — 반응형 클래스로 변경됨
    const propertyPadding = propertySection.closest(".md\\:px-12");

    expect(propertySection.closest("[data-qn-peek-page-header-column]")?.className)
      .toContain("max-w-[784px]");
    expect(propertyPadding).toBeTruthy();

    act(() => {
      useSettingsStore.setState({ pageFullWidthById: { "row-1": true } });
    });
    rerender(<DatabaseRowPeek />);

    expect(screen.getByTestId("peek-db-property-section")
      .closest("[data-qn-peek-page-header-column]")?.className)
      .toContain("max-w-none");
  });
});
