import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDatabaseStore } from "../../../store/databaseStore";
import { usePageStore } from "../../../store/pageStore";
import { useSettingsStore } from "../../../store/settingsStore";
import type { DatabaseBundle } from "../../../types/database";
import type { Page } from "../../../types/page";
import { DatabaseRowPage } from "../DatabaseRowPage";

vi.mock("../../editor/Editor", () => ({
  Editor: () => <div data-testid="row-editor" />,
}));

vi.mock("../../editor/PageCoverImage", () => ({
  PageCoverImage: () => <div data-testid="cover-image" />,
}));

vi.mock("../../page/PageTitleBar", () => ({
  PageTitleBar: () => <div data-testid="page-title-bar" />,
}));

vi.mock("../../page/DbPropertySection", () => ({
  DbPropertySection: () => <div data-testid="db-property-section" />,
}));

vi.mock("../../comments/PageCommentBar", () => ({
  PageCommentBar: () => <div data-testid="page-comment-bar" />,
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

describe("DatabaseRowPage", () => {
  beforeEach(() => {
    usePageStore.setState({
      pages: { "row-1": rowPage },
      activePageId: "row-1",
    });
    useDatabaseStore.setState({ databases: { "db-1": bundle } });
    useSettingsStore.setState({
      fullWidth: false,
      pageFullWidthById: {},
    });
  });

  it("상단 속성 패널 영역도 페이지 전체 너비 설정을 따른다", () => {
    const { rerender } = render(<DatabaseRowPage pageId="row-1" />);
    const propertySection = screen.getByTestId("db-property-section");

    expect(propertySection.closest("[data-qn-row-page-header-column]")?.className)
      .toContain("max-w-[784px]");

    act(() => {
      useSettingsStore.setState({ pageFullWidthById: { "row-1": true } });
    });
    rerender(<DatabaseRowPage pageId="row-1" />);

    expect(screen.getByTestId("db-property-section")
      .closest("[data-qn-row-page-header-column]")?.className)
      .toContain("max-w-none");
  });
});
