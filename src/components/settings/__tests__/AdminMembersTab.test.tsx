import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminMembersTab } from "../AdminMembersTab";
import { useMemberStore } from "../../../store/memberStore";
import { useTeamStore } from "../../../store/teamStore";
import { useWorkspaceOptionsStore } from "../../../store/workspaceOptionsStore";

const createMemberApiMock = vi.fn();

vi.mock("../../../lib/sync/memberApi", () => ({
  createMemberApi: (input: unknown) => createMemberApiMock(input),
}));

describe("AdminMembersTab", () => {
  beforeEach(() => {
    createMemberApiMock.mockReset();
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
});
