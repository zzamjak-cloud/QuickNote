import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import type { DatabasePanelState } from "../../../types/database";
import { emptyPanelState } from "../../../types/database";
import { useDatabaseStore } from "../../../store/databaseStore";
import { useWorkspaceStore } from "../../../store/workspaceStore";
import { DatabaseToolbarControls } from "../DatabaseToolbarControls";

let latestPanelState: DatabasePanelState | null = null;

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

function ToolbarHarness() {
  const [panelState, setPanelStateRaw] = useState<DatabasePanelState>(() =>
    emptyPanelState(),
  );
  latestPanelState = panelState;

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

  it("프리셋 탭 편집 중 아이콘 picker를 input blur로 닫지 않는다", async () => {
    render(<ToolbarHarness />);

    fireEvent.click(screen.getByTitle("필터 프리셋 탭 추가"));
    fireEvent.doubleClick(screen.getByText("탭 1"));

    const input = screen.getByDisplayValue("탭 1");
    input.focus();
    const iconButton = screen.getByRole("button", { name: "페이지 아이콘" });

    const allowDefault = fireEvent.mouseDown(iconButton);
    if (allowDefault) fireEvent.blur(input);
    fireEvent.mouseUp(iconButton);
    fireEvent.click(iconButton);

    expect(screen.queryByPlaceholderText("아이콘 검색")).not.toBeNull();

    const iconOption = screen
      .getAllByRole("button", { name: "업무" })
      .find((button) => button.getAttribute("title") === "업무");
    expect(iconOption).toBeDefined();

    const allowIconDefault = fireEvent.mouseDown(iconOption!);
    if (allowIconDefault) fireEvent.blur(input);
    fireEvent.mouseUp(iconOption!);
    fireEvent.click(iconOption!);

    await waitFor(() => {
      expect(latestPanelState?.filterPresets?.[0]?.icon).toEqual(expect.any(String));
    });
  });

  it("프리셋 탭 아이콘 picker의 이모지 검색 input은 mousedown 기본 동작이 차단되지 않는다", () => {
    render(<ToolbarHarness />);

    fireEvent.click(screen.getByTitle("필터 프리셋 탭 추가"));
    fireEvent.doubleClick(screen.getByText("탭 1"));
    fireEvent.click(screen.getByRole("button", { name: "페이지 아이콘" }));
    fireEvent.click(screen.getByRole("button", { name: "이모지" }));

    const emojiSearchInput = screen.getByPlaceholderText("이모지 검색") as HTMLInputElement;
    expect(fireEvent.mouseDown(emojiSearchInput)).toBe(true);

    emojiSearchInput.focus();
    fireEvent.change(emojiSearchInput, { target: { value: "smile" } });
    expect(emojiSearchInput.value).toBe("smile");
  });
});
