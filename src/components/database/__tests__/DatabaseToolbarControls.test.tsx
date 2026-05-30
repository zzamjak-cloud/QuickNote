import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";
import type { DatabasePanelState } from "../../../types/database";
import { emptyPanelState } from "../../../types/database";
import { useDatabaseStore } from "../../../store/databaseStore";
import { useMemberStore } from "../../../store/memberStore";
import { usePageStore } from "../../../store/pageStore";
import { useWorkspaceStore } from "../../../store/workspaceStore";
import { DatabaseToolbarControls } from "../DatabaseToolbarControls";

let latestPanelState: DatabasePanelState | null = null;

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

function ToolbarHarness({
  initialPanelState = emptyPanelState(),
}: {
  initialPanelState?: DatabasePanelState;
} = {}) {
  const [panelState, setPanelStateRaw] = useState<DatabasePanelState>(() =>
    initialPanelState,
  );
  useEffect(() => {
    latestPanelState = panelState;
  }, [panelState]);

  const setPanelState = (patch: Partial<DatabasePanelState>) => {
    setPanelStateRaw((prev) => ({ ...prev, ...patch }));
  };

  return (
    <DatabaseToolbarControls
      databaseId="db-1"
      viewKind="table"
      view="table"
      onViewChange={() => {}}
      panelState={panelState}
      setPanelState={setPanelState}
      layout="fullPage"
    />
  );
}

describe("DatabaseToolbarControls", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    useWorkspaceStore.setState({
      currentWorkspaceId: null,
    });
    usePageStore.setState({
      pages: {},
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
            title: "테스트 DB",
            createdAt: 1,
            updatedAt: 1,
          },
          columns: [{ id: "title", name: "이름", type: "title" }],
          rowPageOrder: [],
        },
      },
    });
  });

  it("사람 필터는 ID 대신 구성원 이름을 요약과 값 선택 라벨로 표시한다", () => {
    const memberId = "c127410b-b345-4303-9a16-68442c20f902";
    useMemberStore.setState({
      members: [
        {
          memberId,
          email: "choi@example.com",
          name: "최진핑",
          jobRole: "작업자",
          workspaceRole: "member",
          status: "active",
          personalWorkspaceId: "ws-personal",
        },
      ],
      cacheWorkspaceId: "ws-1",
    });
    usePageStore.setState({
      pages: {
        "pg-1": {
          id: "pg-1",
          workspaceId: "ws-1",
          title: "업무 1",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 1,
          createdAt: 1,
          updatedAt: 1,
          databaseId: "db-1",
          dbCells: { assignee: [memberId] },
        },
      },
      activePageId: null,
    });
    useDatabaseStore.setState({
      databases: {
        "db-1": {
          meta: {
            id: "db-1",
            title: "테스트 DB",
            createdAt: 1,
            updatedAt: 1,
          },
          columns: [
            { id: "title", name: "이름", type: "title" },
            { id: "assignee", name: "작업자", type: "person" },
          ],
          rowPageOrder: ["pg-1"],
        },
      },
    });

    const initialPanelState = {
      ...emptyPanelState(),
      filterRules: [
        {
          id: "filter-1",
          columnId: "assignee",
          operator: "equals",
          value: memberId,
        },
      ],
    };

    render(<ToolbarHarness initialPanelState={initialPanelState} />);

    fireEvent.click(screen.getByRole("button", { name: "필터" }));

    const summary = screen.queryByText("최진핑");
    expect(summary).not.toBeNull();
    expect(screen.queryByText(memberId)).toBeNull();

    fireEvent.click(summary!);
    expect(screen.getAllByText("최진핑").length).toBeGreaterThanOrEqual(2);
  });

  it("페이지 연결 필터는 페이지 ID 대신 제목을 요약과 값 선택 라벨로 표시한다", () => {
    const linkedPageId = "b141c65b-ca65-4dc4-af1b-7c183b5bed24";
    usePageStore.setState({
      pages: {
        "pg-1": {
          id: "pg-1",
          workspaceId: "ws-1",
          title: "업무 1",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 1,
          createdAt: 1,
          updatedAt: 1,
          databaseId: "db-1",
          dbCells: { relatedPage: [linkedPageId] },
        },
        [linkedPageId]: {
          id: linkedPageId,
          workspaceId: "ws-1",
          title: "연결된 기획서",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 2,
          createdAt: 1,
          updatedAt: 1,
        },
      },
      activePageId: null,
    });
    useDatabaseStore.setState({
      databases: {
        "db-1": {
          meta: {
            id: "db-1",
            title: "테스트 DB",
            createdAt: 1,
            updatedAt: 1,
          },
          columns: [
            { id: "title", name: "이름", type: "title" },
            { id: "relatedPage", name: "관련 페이지", type: "pageLink" },
          ],
          rowPageOrder: ["pg-1"],
        },
      },
    });

    const initialPanelState = {
      ...emptyPanelState(),
      filterRules: [
        {
          id: "filter-1",
          columnId: "relatedPage",
          operator: "equals",
          value: linkedPageId,
        },
      ],
    };

    render(<ToolbarHarness initialPanelState={initialPanelState} />);

    fireEvent.click(screen.getByRole("button", { name: "필터" }));

    const summary = screen.queryByText("연결된 기획서");
    expect(summary).not.toBeNull();
    expect(screen.queryByText(linkedPageId)).toBeNull();

    fireEvent.click(summary!);
    expect(screen.getAllByText("연결된 기획서").length).toBeGreaterThanOrEqual(2);
  });

  it("프리셋 탭 편집은 이름 입력만 표시하고 blur 시 이름을 커밋한다", async () => {
    render(<ToolbarHarness />);

    fireEvent.click(screen.getByTitle("필터 프리셋 탭 추가"));
    fireEvent.doubleClick(screen.getByText("탭 1"));

    const input = screen.getByDisplayValue("탭 1");
    expect(screen.queryByRole("button", { name: "페이지 아이콘" })).toBeNull();

    fireEvent.change(input, { target: { value: "검토 탭" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(latestPanelState?.filterPresets?.[0]?.name).toBe("검토 탭");
    });
  });

  it("프리셋 탭 버튼은 pointer 커서와 scale 클릭 피드백을 사용한다", () => {
    render(<ToolbarHarness />);

    fireEvent.click(screen.getByTitle("필터 프리셋 탭 추가"));

    const tabButton = screen.getByText("탭 1").closest("button");
    expect(tabButton).not.toBeNull();
    expect(tabButton).toHaveClass("cursor-pointer");
    expect(tabButton).toHaveClass("active:scale-[0.985]");
    expect(tabButton).not.toHaveClass("cursor-grab");
    expect(tabButton).not.toHaveClass("active:cursor-grabbing");
  });
});
