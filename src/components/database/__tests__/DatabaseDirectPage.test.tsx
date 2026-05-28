import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseDirectPage } from "../DatabaseDirectPage";
import { useDatabaseStore } from "../../../store/databaseStore";
import type { DatabaseBundle } from "../../../types/database";

vi.mock("../DatabaseFullPageStandalone", () => ({
  DatabaseFullPageStandalone: ({ databaseId }: { databaseId: string }) => (
    <div data-testid="direct-db-content">{databaseId}</div>
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
  });

  it("uses full-width layout by default and exposes DB actions", () => {
    render(<DatabaseDirectPage databaseId="db-1" />);

    expect(screen.getByTestId("database-direct-page-shell").className).toContain("max-w-none");
    expect(screen.getByRole("button", { name: "DB 버전 히스토리" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "데이터베이스 삭제" })).toBeTruthy();
    expect(screen.getByTestId("direct-db-content").textContent).toBe("db-1");
  });
});
