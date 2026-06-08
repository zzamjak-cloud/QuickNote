import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDatabaseRowIndexStore } from "../../../store/databaseRowIndexStore";
import { useDatabaseStore } from "../../../store/databaseStore";
import { usePageStore } from "../../../store/pageStore";
import { useUiStore } from "../../../store/uiStore";
import { useWorkspaceStore } from "../../../store/workspaceStore";
import { ensurePageContentLoaded } from "../../../lib/sync/pageContentLoad";
import { useAddDatabaseRowAndOpen, useOpenDatabaseRow } from "../useOpenDatabaseRow";
import type { FilterRule } from "../../../types/database";

vi.mock("../../../lib/sync/pageContentLoad", () => ({
  ensurePageContentLoaded: vi.fn(),
}));

const ensurePageContentLoadedMock = vi.mocked(ensurePageContentLoaded);
const originalAddRow = useDatabaseStore.getState().addRow;

function HookProbe({
  databaseId,
  onReady,
}: {
  databaseId: string;
  onReady: (openRow: ReturnType<typeof useOpenDatabaseRow>) => void;
}) {
  const openRow = useOpenDatabaseRow(databaseId);
  onReady(openRow);
  return null;
}

function AddRowProbe({
  databaseId,
  onReady,
}: {
  databaseId: string;
  onReady: (addRowAndOpen: ReturnType<typeof useAddDatabaseRowAndOpen>) => void;
}) {
  const addRowAndOpen = useAddDatabaseRowAndOpen(databaseId);
  onReady(addRowAndOpen);
  return null;
}

describe("useOpenDatabaseRow", () => {
  beforeEach(() => {
    ensurePageContentLoadedMock.mockReset();
    useWorkspaceStore.setState({ currentWorkspaceId: "current-ws" });
    usePageStore.setState({ pages: {} });
    useUiStore.setState({ peekPageId: null, peekHistory: [], toasts: [] });
    useDatabaseStore.setState({ addRow: originalAddRow });
    useDatabaseRowIndexStore.setState({
      snapshotsByKey: {},
      hydratedByKey: {},
      loadingByKey: {},
    });
  });

  it("cached-only row는 row index workspaceId로 본문 로드 후 피커뷰를 연다", async () => {
    useDatabaseRowIndexStore.setState({
      snapshotsByKey: {
        "db-1": {
          v: 1,
          indexKey: "db-1",
          databaseId: "db-1",
          complete: true,
          updatedAt: 1,
          rows: [
            {
              pageId: "row-cached",
              workspaceId: "remote-ws",
              databaseId: "db-1",
              title: "캐시 행",
              icon: null,
              order: 0,
              dbCells: {},
              updatedAt: 2,
            },
          ],
        },
      },
      hydratedByKey: { "db-1": true },
    });
    ensurePageContentLoadedMock.mockImplementation(async ({ pageId }) => {
      usePageStore.setState({
        pages: {
          [pageId]: {
            id: pageId,
            workspaceId: "remote-ws",
            title: "캐시 행",
            icon: null,
            doc: { type: "doc", content: [] },
            parentId: null,
            order: 0,
            createdAt: 1,
            updatedAt: 2,
            databaseId: "db-1",
            contentLoaded: true,
          },
        },
      });
      return true;
    });

    let openRow: ReturnType<typeof useOpenDatabaseRow> | null = null;
    render(<HookProbe databaseId="db-1" onReady={(value) => { openRow = value; }} />);

    await act(async () => {
      await openRow?.("row-cached", { source: "test-open" });
    });

    expect(ensurePageContentLoadedMock).toHaveBeenCalledWith({
      pageId: "row-cached",
      workspaceId: "remote-ws",
      source: "test-open",
    });
    expect(useUiStore.getState().peekPageId).toBe("row-cached");
  });

  it("본문 로드가 실패하면 placeholder row가 있어도 피커뷰를 열지 않는다", async () => {
    usePageStore.setState({
      pages: {
        "row-placeholder": {
          id: "row-placeholder",
          workspaceId: "remote-ws",
          title: "미완료 행",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 0,
          createdAt: 1,
          updatedAt: 2,
          databaseId: "db-1",
          contentLoaded: false,
        },
      },
    });
    ensurePageContentLoadedMock.mockResolvedValueOnce(false);

    let openRow: ReturnType<typeof useOpenDatabaseRow> | null = null;
    render(<HookProbe databaseId="db-1" onReady={(value) => { openRow = value; }} />);

    await act(async () => {
      await openRow?.("row-placeholder", { source: "test-open-failed" });
    });

    expect(ensurePageContentLoadedMock).toHaveBeenCalledWith({
      pageId: "row-placeholder",
      workspaceId: "remote-ws",
      source: "test-open-failed",
    });
    expect(useUiStore.getState().peekPageId).toBeNull();
    expect(useUiStore.getState().toasts.at(-1)?.message).toBe(
      "항목 페이지를 불러오지 못했습니다.",
    );
  });

  it("새 행을 생성한 뒤 반환된 pageId로 피커뷰를 연다", async () => {
    const seedFilters: FilterRule[] = [
      { id: "filter-1", columnId: "status", operator: "equals", value: "todo" },
    ];
    const addRowMock = vi.fn(() => "row-created");
    useDatabaseStore.setState({
      addRow: addRowMock as unknown as typeof originalAddRow,
    });
    ensurePageContentLoadedMock.mockResolvedValueOnce(true);

    let addRowAndOpen: ReturnType<typeof useAddDatabaseRowAndOpen> | null = null;
    render(
      <AddRowProbe
        databaseId="db-1"
        onReady={(value) => {
          addRowAndOpen = value;
        }}
      />,
    );

    await act(async () => {
      addRowAndOpen?.(seedFilters, { source: "database-add-row-open" });
      await Promise.resolve();
    });

    expect(addRowMock).toHaveBeenCalledWith("db-1", seedFilters);
    expect(ensurePageContentLoadedMock).toHaveBeenCalledWith({
      pageId: "row-created",
      workspaceId: "current-ws",
      source: "database-add-row-open",
    });
    expect(useUiStore.getState().peekPageId).toBe("row-created");
  });
});
