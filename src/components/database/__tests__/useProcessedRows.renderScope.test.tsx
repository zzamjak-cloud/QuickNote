import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { emptyPanelState } from "../../../types/database";
import type { DatabaseRowView } from "../../../types/database";
import { useDatabaseStore } from "../../../store/databaseStore";
import { useMemberStore } from "../../../store/memberStore";
import { usePageStore } from "../../../store/pageStore";
import { useProcessedRows } from "../useProcessedRows";

let renderCount = 0;
const rowsSnapshots: DatabaseRowView[][] = [];

function Probe({ panelState = emptyPanelState() }: { panelState?: ReturnType<typeof emptyPanelState> }) {
  const { rows } = useProcessedRows("db-1", panelState);
  useEffect(() => {
    renderCount += 1;
    rowsSnapshots.push(rows);
  });
  return (
    <div>
      <output aria-label="row-count">{rows.length}</output>
    </div>
  );
}

describe("useProcessedRows render scope", () => {
  beforeEach(() => {
    renderCount = 0;
    rowsSnapshots.length = 0;
    usePageStore.setState({
      pages: {
        "row-1": {
          id: "row-1",
          workspaceId: "ws-1",
          title: "업무 1",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 1,
          createdAt: 1,
          updatedAt: 1,
          databaseId: "db-1",
          dbCells: {},
        },
      },
      activePageId: null,
    });
    useMemberStore.setState({
      members: [],
      cacheWorkspaceId: null,
      lastFetchedAt: null,
      mentionCandidates: [],
      mentionQuery: "",
    });
    useDatabaseStore.setState({
      databases: {
        "db-1": {
          meta: {
            id: "db-1",
            title: "렌더 대상 DB",
            createdAt: 1,
            updatedAt: 1,
          },
          columns: [{ id: "title", name: "이름", type: "title" }],
          rowPageOrder: ["row-1"],
        },
        "db-2": {
          meta: {
            id: "db-2",
            title: "무관한 DB",
            createdAt: 1,
            updatedAt: 1,
          },
          columns: [{ id: "title", name: "이름", type: "title" }],
          rowPageOrder: [],
        },
      },
      cacheWorkspaceId: null,
    });
  });

  it("무관한 DB 업데이트는 Probe를 다시 렌더링하지 않는다", () => {
    render(<Probe />);

    expect(screen.getByLabelText("row-count").textContent).toBe("1");
    const initialRenderCount = renderCount;

    act(() => {
      useDatabaseStore.setState((state) => ({
        databases: {
          ...state.databases,
          "db-2": {
            ...state.databases["db-2"]!,
            meta: {
              ...state.databases["db-2"]!.meta,
              title: "무관한 DB 수정",
              updatedAt: 2,
            },
          },
        },
      }));
    });

    expect(renderCount).toBe(initialRenderCount);
  });

  it("필터·정렬과 무관한 표시 설정 변경은 rows reference를 재사용한다", () => {
    const panelState = emptyPanelState();
    const { rerender } = render(<Probe panelState={panelState} />);

    const initialRows = rowsSnapshots.at(-1);
    expect(initialRows).toBeDefined();

    rerender(
      <Probe
        panelState={{
          ...panelState,
          viewConfigs: {
            table: { hiddenColumnIds: ["title"] },
          },
        }}
      />,
    );

    expect(rowsSnapshots.at(-1)).toBe(initialRows);
  });
});
