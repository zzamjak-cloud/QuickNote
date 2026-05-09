import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminTeamsTab } from "../AdminTeamsTab";
import { useTeamStore } from "../../../store/teamStore";

const createTeamApiMock = vi.fn();
const deleteTeamApiMock = vi.fn();

vi.mock("../../../lib/sync/teamApi", () => ({
  createTeamApi: (name: string) => createTeamApiMock(name),
  deleteTeamApi: (teamId: string) => deleteTeamApiMock(teamId),
}));

describe("AdminTeamsTab", () => {
  beforeEach(() => {
    createTeamApiMock.mockReset();
    deleteTeamApiMock.mockReset();
    useTeamStore.setState({
      teams: [
        {
          teamId: "t1",
          name: "Design",
          members: [
            {
              memberId: "m1",
              email: "m1@x.com",
              name: "Alice",
              jobRole: "Designer",
              workspaceRole: "member",
              status: "active",
              personalWorkspaceId: "ws-1",
            },
          ],
        },
      ],
    });
  });

  it("팀 목록 카드에 팀명·인원수·구성원 관리 라벨을 렌더링한다", () => {
    render(<AdminTeamsTab />);
    expect(screen.getByText("Design (1명)")).toBeTruthy();
    expect(screen.getByLabelText("Design 구성원 관리")).toBeTruthy();
  });

  it("팀 추가/삭제 액션이 API를 호출한다", async () => {
    createTeamApiMock.mockResolvedValue({
      teamId: "t2",
      name: "Platform",
      members: [],
    });
    deleteTeamApiMock.mockResolvedValue(true);

    render(<AdminTeamsTab />);
    // 모달 열기
    fireEvent.click(screen.getByText("팀 추가"));
    fireEvent.change(screen.getByPlaceholderText("팀 이름"), {
      target: { value: "Platform" },
    });
    await act(async () => {
      fireEvent.click(screen.getByText("추가"));
    });
    await waitFor(() => expect(createTeamApiMock).toHaveBeenCalledWith("Platform"));

    fireEvent.click(screen.getByLabelText("Design 구성원 관리"));
    fireEvent.click(screen.getByRole("button", { name: "팀 삭제" }));
    fireEvent.click(screen.getByText("삭제"));
    await waitFor(() => expect(deleteTeamApiMock).toHaveBeenCalledWith("t1"));
  });
});
