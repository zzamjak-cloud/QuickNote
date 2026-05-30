import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseDirectPage } from "../DatabaseDirectPage";
import { useDatabaseStore } from "../../../store/databaseStore";
import { usePageStore } from "../../../store/pageStore";
import type { DatabaseBundle } from "../../../types/database";

vi.mock("../DatabaseFullPageStandalone", () => ({
  DatabaseFullPageStandalone: ({
    databaseId,
    pageId,
    view,
    panelStateRaw,
  }: {
    databaseId: string;
    pageId?: string;
    view?: string;
    panelStateRaw?: string;
  }) => (
    <div
      data-testid="direct-db-content"
      data-page-id={pageId ?? ""}
      data-view={view ?? ""}
      data-panel-state={panelStateRaw ?? ""}
    >
      {databaseId}
    </div>
  ),
}));

describe("DatabaseDirectPage", () => {
  beforeEach(() => {
    const bundle: DatabaseBundle = {
      meta: {
        id: "db-1",
        title: "작업 DB",
        createdAt: 1,
        updatedAt: 2,
      },
      columns: [{ id: "title", name: "제목", type: "title" }],
      rowPageOrder: [],
    };
    useDatabaseStore.setState({ databases: { "db-1": bundle } });
    usePageStore.setState({ pages: {}, activePageId: null });
  });

  it("uses full-width layout by default and exposes DB actions", () => {
    render(<DatabaseDirectPage databaseId="db-1" />);

    expect(screen.getByTestId("database-direct-page-shell").className).toContain("max-w-none");
    expect(screen.getByRole("button", { name: "DB 버전 히스토리" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "데이터베이스 삭제" })).toBeTruthy();
    expect(screen.getByTestId("direct-db-content").textContent).toBe("db-1");
  });

  it("uses full-page document attrs when pageId is provided", () => {
    usePageStore.setState({
      pages: {
        "pg-full": {
          id: "pg-full",
          title: "작업 DB",
          icon: null,
          doc: {
            type: "doc",
            content: [
              {
                type: "databaseBlock",
                attrs: {
                  databaseId: "db-1",
                  layout: "fullPage",
                  view: "gallery",
                  panelState: "{\"activePresetId\":\"preset-1\"}",
                },
              },
            ],
          },
          parentId: null,
          order: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      },
      activePageId: null,
    });

    render(<DatabaseDirectPage databaseId="db-1" pageId="pg-full" />);

    const content = screen.getByTestId("direct-db-content");
    expect(content.dataset.pageId).toBe("pg-full");
    expect(content.dataset.view).toBe("gallery");
    expect(content.dataset.panelState).toBe("{\"activePresetId\":\"preset-1\"}");
  });
});
