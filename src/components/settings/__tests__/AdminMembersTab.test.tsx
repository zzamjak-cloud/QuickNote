import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminMembersTab } from "../AdminMembersTab";
import { useMemberStore } from "../../../store/memberStore";
import { useTeamStore } from "../../../store/teamStore";
import { useWorkspaceOptionsStore } from "../../../store/workspaceOptionsStore";

const createMemberApiMock = vi.fn();
const removeMemberApiMock = vi.fn();
const unassignTeamMock = vi.fn();
const deleteMemberApiMock = vi.fn();

vi.mock("../../../lib/sync/memberApi", () => ({
  createMemberApi: (input: unknown) => createMemberApiMock(input),
  removeMemberApi: (id: string) => removeMemberApiMock(id),
  deleteMemberApi: (id: string) => deleteMemberApiMock(id),
  unassignMemberFromTeamApi: (memberId: string, teamId: string) => unassignTeamMock(memberId, teamId),
}));

vi.mock("../../../lib/sync/organizationApi", () => ({
  unassignMemberFromOrganizationApi: vi.fn().mockResolvedValue(true),
}));

describe("AdminMembersTab", () => {
  beforeEach(() => {
    createMemberApiMock.mockReset();
    removeMemberApiMock.mockReset();
    deleteMemberApiMock.mockReset();
    unassignTeamMock.mockReset().mockResolvedValue(true);
    // 직무 select 옵션에 "PM"이 나타나도록 초기화
    useWorkspaceOptionsStore.setState({ jobFunctions: ["PM"], jobTitles: [] });
    useMemberStore.setState({
      me: null,
      mentionCandidates: [],
      mentionQuery: "",
      members: [
        {
          memberId: "m1",
          email: "alice@x.com",
          name: "Alice",
          jobRole: "Engineer",
          workspaceRole: "member",
          status: "active",
          personalWorkspaceId: "ws-1",
        },
        {
          memberId: "m2",
          email: "bob@x.com",
          name: "Bob",
          jobRole: "Designer",
          workspaceRole: "manager",
          status: "active",
          personalWorkspaceId: "ws-2",
        },
      ],
    });
    useTeamStore.setState({
      teams: [
        {
          teamId: "t1",
          name: "CAT",
          members: [
            {
              memberId: "m1",
              email: "alice@x.com",
              name: "Alice",
              jobRole: "Engineer",
              workspaceRole: "member",
              status: "active",
              personalWorkspaceId: "ws-1",
            },
          ],
        },
      ],
    });
  });

  it("구성원 목록 렌더 + 필터 동작", () => {
    render(<AdminMembersTab />);
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText("Bob")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("이름/이메일/직무 검색"), {
      target: { value: "designer" },
    });
    expect(screen.queryByText("Alice")).toBeNull();
    expect(screen.getByText("Bob")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("이름/이메일/직무 검색"), {
      target: { value: "cat" },
    });
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.queryByText("Bob")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "검색어 전체 삭제" }));
    expect((screen.getByPlaceholderText("이름/이메일/직무 검색") as HTMLInputElement).value).toBe("");

    fireEvent.change(screen.getByPlaceholderText("이름/이메일/직무 검색"), {
      target: { value: "alice" },
    });
    fireEvent.click(screen.getByRole("button", { name: "보관함" }));
    expect((screen.getByPlaceholderText("이름/이메일/직무 검색") as HTMLInputElement).value).toBe("");

    fireEvent.change(screen.getByPlaceholderText("이름/이메일/직무 검색"), {
      target: { value: "bob" },
    });
    fireEvent.click(screen.getByRole("button", { name: "구성원" }));
    expect((screen.getByPlaceholderText("이름/이메일/직무 검색") as HTMLInputElement).value).toBe("");
  });

  it("추가 모달 저장 시 createMember 호출", async () => {
    createMemberApiMock.mockResolvedValue({
      memberId: "m3",
      email: "new@x.com",
      name: "New",
      jobRole: "PM",
      workspaceRole: "member",
      status: "active",
      personalWorkspaceId: "ws-3",
    });

    render(<AdminMembersTab />);
    fireEvent.click(screen.getByText("구성원 추가"));

    fireEvent.change(screen.getByPlaceholderText("이름"), { target: { value: "New" } });
    fireEvent.change(screen.getByPlaceholderText("이메일"), { target: { value: "new@x.com" } });
    // 직무 선택
    const dialog = screen.getByRole("dialog");
    const jobRoleButton = within(dialog).getByRole("button", { name: "직무" });
    fireEvent.click(jobRoleButton);
    fireEvent.click(within(dialog).getByRole("option", { name: "PM" }));
    fireEvent.click(screen.getByText("추가"));

    await waitFor(() => expect(createMemberApiMock).toHaveBeenCalledTimes(1));
    expect(createMemberApiMock.mock.calls[0]?.[0]).toMatchObject({
      email: "new@x.com",
      name: "New",
      jobRole: "PM",
      workspaceRole: "MEMBER",
    });
  });
  it("체크한 구성원을 일괄 제거(보관함 이동)하고 팀에서 분리", async () => {
    removeMemberApiMock.mockImplementation((id: string) => Promise.resolve({ memberId: id, status: "removed" }));
    render(<AdminMembersTab />);

    fireEvent.click(screen.getByRole("checkbox", { name: "구성원 전체 선택" }));
    fireEvent.click(screen.getByRole("button", { name: "선택 제거 (2)" }));
    fireEvent.click(screen.getByRole("button", { name: "제거" }));

    await waitFor(() => expect(removeMemberApiMock).toHaveBeenCalledTimes(2));
    expect(unassignTeamMock).toHaveBeenCalledWith("m1", "t1");
    await waitFor(() =>
      expect(useMemberStore.getState().members.every((m) => m.status === "removed")).toBe(true),
    );
    expect(useTeamStore.getState().teams[0]?.members).toHaveLength(0);
    expect(screen.queryByText("Alice")).toBeNull();
  });

  it("오너·본인은 체크 불가, 실패한 구성원은 선택 유지 + 오류 표시", async () => {
    useMemberStore.setState((s) => ({
      me: s.members[1] ?? null,
      members: [
        ...s.members,
        { memberId: "m3", email: "o@x.com", name: "Owen", jobRole: "", workspaceRole: "owner", status: "active", personalWorkspaceId: "ws-3" },
      ],
    }));
    removeMemberApiMock.mockRejectedValue(new Error("boom"));
    render(<AdminMembersTab />);

    expect((screen.getByRole("checkbox", { name: "Owen 선택" }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Bob 선택" }) as HTMLInputElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("checkbox", { name: "Alice 선택" }));
    fireEvent.click(screen.getByRole("button", { name: "선택 제거 (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "제거" }));

    await waitFor(() => expect(screen.getByText(/1명 제거 실패: Alice/)).toBeTruthy());
    expect((screen.getByRole("checkbox", { name: "Alice 선택" }) as HTMLInputElement).checked).toBe(true);
  });

  it("보관함 구성원을 일괄 영구 삭제하면 목록에서 사라지고, 실패는 선택 유지", async () => {
    useMemberStore.setState((st) => ({
      members: st.members.map((m) => ({ ...m, status: "removed" as const })),
    }));
    deleteMemberApiMock.mockImplementation((id: string) =>
      id === "m1" ? Promise.resolve(true) : Promise.reject(new Error("boom")),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<AdminMembersTab />);

    fireEvent.click(screen.getByRole("button", { name: "보관함" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "구성원 전체 선택" }));
    fireEvent.click(screen.getByRole("button", { name: "선택 영구 삭제 (2)" }));
    fireEvent.click(screen.getByRole("button", { name: "영구 삭제" }));

    await waitFor(() => expect(deleteMemberApiMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText(/1명 영구 삭제 실패: Bob/)).toBeTruthy());
    expect(useMemberStore.getState().members.map((m) => m.memberId)).toEqual(["m2"]);
    expect((screen.getByRole("checkbox", { name: "Bob 선택" }) as HTMLInputElement).checked).toBe(true);
  });
});
