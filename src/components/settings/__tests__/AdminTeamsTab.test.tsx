import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminTeamsTab } from "../AdminTeamsTab";
import { useTeamStore } from "../../../store/teamStore";

const createTeamApiMock = vi.fn();
const deleteTeamApiMock = vi.fn();
const archiveTeamApiMock = vi.fn();

vi.mock("../../../lib/sync/teamApi", () => ({
  archiveTeamApi: (teamId: string) => archiveTeamApiMock(teamId),
  createTeamApi: (name: string) => createTeamApiMock(name),
  deleteTeamApi: (teamId: string) => deleteTeamApiMock(teamId),
}));

describe("AdminTeamsTab", () => {
  beforeEach(() => {
    createTeamApiMock.mockReset();
    deleteTeamApiMock.mockReset();
    archiveTeamApiMock.mockReset();
    useTeamStore.setState({
      teams: [
        {
          teamId: "t1",
          name: "Design",
          leaderMemberIds: [],
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
    const card = screen.getByLabelText("Design 구성원 관리");
    expect(card.textContent).toContain("Design");
    expect(card.textContent).toContain("구성원 1명");
  });

  it("팀 추가/보관함 이동 액션이 API를 호출한다", async () => {
    createTeamApiMock.mockResolvedValue({
      teamId: "t2",
      name: "Platform",
      leaderMemberIds: [],
      members: [],
    });
    archiveTeamApiMock.mockResolvedValue({
      teamId: "t1",
      name: "Design",
      leaderMemberIds: [],
      members: [],
      removedAt: "2026-05-18T00:00:00.000Z",
    });

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
    fireEvent.click(screen.getByRole("button", { name: "보관함으로 이동" }));
    await waitFor(() => expect(archiveTeamApiMock).toHaveBeenCalledWith("t1"));
  });

  it("체크한 팀을 일괄 보관함 이동, 실패한 팀은 선택 유지", async () => {
    useTeamStore.setState((st) => ({
      teams: [...st.teams, { teamId: "t2", name: "Platform", leaderMemberIds: [], members: [] }],
    }));
    archiveTeamApiMock.mockImplementation((teamId: string) =>
      teamId === "t2"
        ? Promise.reject(new Error("boom"))
        : Promise.resolve({ teamId, name: "Design", leaderMemberIds: [], members: [], removedAt: "2026-10-27T00:00:00.000Z" }),
    );
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(<AdminTeamsTab />);
    fireEvent.click(screen.getByRole("checkbox", { name: "전체 선택" }));
    fireEvent.click(screen.getByRole("button", { name: "선택한 2개 보관함 이동" }));
    fireEvent.click(screen.getByRole("button", { name: "보관함 이동" }));

    await waitFor(() => expect(archiveTeamApiMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(useTeamStore.getState().teams.find((t) => t.teamId === "t1")?.removedAt).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: "Platform 선택" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole("checkbox", { name: "Design 선택" })).toBeNull();
  });
});
