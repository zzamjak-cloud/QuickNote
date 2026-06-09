import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyPanelState } from "../../../types/database";
import { useDatabaseStore } from "../../../store/databaseStore";
import { useUiStore } from "../../../store/uiStore";
import { DatabaseColumnSettingsButton } from "../DatabaseColumnSettingsButton";

describe("DatabaseColumnSettingsButton", () => {
  beforeEach(() => {
    useUiStore.setState({ openColumnMenuId: null });
    useDatabaseStore.setState({
      databases: {
        "db-1": {
          meta: {
            id: "db-1",
            title: "DB 1",
            createdAt: 1,
            updatedAt: 1,
          },
          columns: [{ id: "title", name: "제목", type: "title" }],
          rowPageOrder: [],
        },
      },
      cacheWorkspaceId: "ws-1",
    });
  });

  it("하위 페이지 트리 스위치는 기본 OFF이고 클릭하면 ON 패치를 보낸다", () => {
    const setPanelState = vi.fn();

    render(
      <DatabaseColumnSettingsButton
        databaseId="db-1"
        viewKind="list"
        panelState={emptyPanelState()}
        setPanelState={setPanelState}
      />,
    );

    fireEvent.click(screen.getByTitle("표시 설정"));

    const treeSwitch = screen.getByRole("switch", {
      name: "하위 페이지 트리 활성화",
    });
    expect(treeSwitch).toHaveAttribute("aria-checked", "false");

    fireEvent.click(treeSwitch);

    expect(setPanelState).toHaveBeenCalledWith({ pageTreeEnabled: true });
  });
});
