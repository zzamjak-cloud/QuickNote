import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectsPanel } from "../ProjectsPanel";
import {
  useSchedulerProjectsStore,
  type SchedulerProject,
} from "../../../../store/schedulerProjectsStore";

vi.mock("../../../../lib/sync/workspaceMetaCache", () => ({
  refreshWorkspaceMeta: vi.fn().mockResolvedValue(undefined),
}));

const updateProjectMock = vi.fn();
const deleteProjectMock = vi.fn();

function project(id: string, name: string, isHidden: boolean): SchedulerProject {
  return {
    id,
    workspaceId: "ws",
    name,
    color: "#000",
    memberIds: [],
    leaderMemberIds: [],
    isHidden,
    createdByMemberId: "m1",
    createdAt: "",
    updatedAt: "",
  };
}

describe("ProjectsPanel 일괄 선택", () => {
  beforeEach(() => {
    updateProjectMock.mockReset().mockResolvedValue(undefined);
    deleteProjectMock.mockReset().mockResolvedValue(undefined);
    useSchedulerProjectsStore.setState({
      workspaceId: "ws",
      projects: [
        project("p1", "Alpha", false),
        project("p2", "Beta", false),
        project("p3", "Old1", true),
        project("p4", "Old2", true),
      ],
      updateProject: updateProjectMock,
      deleteProject: deleteProjectMock,
    });
  });

  it("활성 프로젝트를 일괄 보관함 이동", async () => {
    render(<ProjectsPanel />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Alpha 선택" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Beta 선택" }));
    fireEvent.click(screen.getByRole("button", { name: "선택한 2개 보관함 이동" }));
    fireEvent.click(screen.getByRole("button", { name: "보관함 이동" }));

    await waitFor(() => expect(updateProjectMock).toHaveBeenCalledTimes(2));
    expect(updateProjectMock).toHaveBeenCalledWith({ id: "p1", workspaceId: "ws", isHidden: true });
    expect(updateProjectMock).toHaveBeenCalledWith({ id: "p2", workspaceId: "ws", isHidden: true });
  });

  it("보관된 프로젝트를 일괄 영구 삭제", async () => {
    render(<ProjectsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "보관함" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "전체 선택" }));
    fireEvent.click(screen.getByRole("button", { name: "선택한 2개 영구 삭제" }));
    fireEvent.click(screen.getByRole("button", { name: "영구 삭제" }));

    await waitFor(() => expect(deleteProjectMock).toHaveBeenCalledTimes(2));
    expect(deleteProjectMock).toHaveBeenCalledWith("p3", "ws");
    expect(deleteProjectMock).toHaveBeenCalledWith("p4", "ws");
  });
});
