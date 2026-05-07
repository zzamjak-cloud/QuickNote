import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminWorkspacesTab } from "../AdminWorkspacesTab";
import { useWorkspaceStore } from "../../../store/workspaceStore";
import { useMemberStore } from "../../../store/memberStore";
import { useTeamStore } from "../../../store/teamStore";

const createWorkspaceApiMock = vi.fn();
const updateWorkspaceApiMock = vi.fn();
const setWorkspaceAccessApiMock = vi.fn();
const deleteWorkspaceApiMock = vi.fn();
const getWorkspaceApiMock = vi.fn();

vi.mock("../../../lib/sync/workspaceApi", () => ({
  createWorkspaceApi: (...args: unknown[]) => createWorkspaceApiMock(...args),
  updateWorkspaceApi: (...args: unknown[]) => updateWorkspaceApiMock(...args),
  setWorkspaceAccessApi: (...args: unknown[]) => setWorkspaceAccessApiMock(...args),
  deleteWorkspaceApi: (...args: unknown[]) => deleteWorkspaceApiMock(...args),
  getWorkspaceApi: (...args: unknown[]) => getWorkspaceApiMock(...args),
}));

describe("AdminWorkspacesTab", () => {
  beforeEach(() => {
    createWorkspaceApiMock.mockReset();
    updateWorkspaceApiMock.mockReset();
    setWorkspaceAccessApiMock.mockReset();
    deleteWorkspaceApiMock.mockReset();
    getWorkspaceApiMock.mockReset();
    useWorkspaceStore.setState({
      currentWorkspaceId: "ws-1",
      workspaces: [
        {
          workspaceId: "ws-1",
          name: "Personal",
          type: "personal",
          ownerMemberId: "m-1",
          myEffectiveLevel: "edit",
        },
        {
          workspaceId: "ws-2",
          name: "HR",
          type: "shared",
          ownerMemberId: "m-owner",
          myEffectiveLevel: "view",
        },
        {
          workspaceId: "ws-3",
          name: "Engineering",
          type: "shared",
          ownerMemberId: "m-owner",
          myEffectiveLevel: "edit",
        },
      ],
    });
    useMemberStore.setState({
      me: null,
      members: [
        {
          memberId: "m-2",
          email: "m2@quicknote.app",
          name: "Member Two",
          jobRole: "Dev",
          workspaceRole: "member",
          status: "active",
          personalWorkspaceId: "ws-p2",
        },
      ],
      mentionCandidates: [],
      mentionQuery: "",
    });
    useTeamStore.setState({
      teams: [{ teamId: "t-1", name: "Core", members: [] }],
    });
  });

  it("공유 워크스페이스 목록만 표시한다", () => {
    render(<AdminWorkspacesTab />);
    expect(screen.queryByText("Personal")).toBeNull();
    expect(screen.getByText("HR")).toBeTruthy();
    expect(screen.getByText("Engineering")).toBeTruthy();
  });

  it("행 클릭 시 상세 패널을 표시한다", () => {
    render(<AdminWorkspacesTab />);
    expect(screen.getAllByLabelText("HR 설정 편집").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("HR 삭제").length).toBeGreaterThan(0);
  });

  it("생성 모달에서 EVERYONE EDIT 규칙 추가 후 생성한다", async () => {
    createWorkspaceApiMock.mockResolvedValue({
      workspaceId: "ws-9",
      name: "New WS",
      type: "shared",
      ownerMemberId: "m-owner",
      myEffectiveLevel: "edit",
    });

    render(<AdminWorkspacesTab />);

    fireEvent.click(screen.getByText("워크스페이스 생성"));
    fireEvent.change(screen.getByPlaceholderText("워크스페이스 이름"), {
      target: { value: "New WS" },
    });

    // 규칙 추가 폼 열기
    fireEvent.click(screen.getByText("규칙 추가"));
    // addType select(MEMBER/TEAM/EVERYONE)과 addLevel select(EDIT/VIEW)를 찾아 EVERYONE EDIT 선택
    const selects = screen.getAllByRole("combobox");
    const addTypeSelect = selects.find((s) =>
      Array.from(s.querySelectorAll("option")).some((o) => (o as HTMLOptionElement).value === "EVERYONE"),
    );
    const addLevelSelect = selects.find((s) =>
      Array.from(s.querySelectorAll("option")).some((o) => (o as HTMLOptionElement).value === "EDIT"),
    );
    fireEvent.change(addTypeSelect!, { target: { value: "EVERYONE" } });
    fireEvent.change(addLevelSelect!, { target: { value: "EDIT" } });
    fireEvent.click(screen.getByText("추가"));

    await act(async () => {
      fireEvent.click(screen.getByText("저장"));
    });

    await vi.waitFor(() => {
      expect(createWorkspaceApiMock).toHaveBeenCalledTimes(1);
    });
    expect(createWorkspaceApiMock).toHaveBeenCalledWith({
      name: "New WS",
      access: [{ subjectType: "EVERYONE", subjectId: undefined, level: "EDIT" }],
    });
  });

  it("설정 편집 저장 시 update/setAccess를 순서대로 호출한다", async () => {
    getWorkspaceApiMock.mockResolvedValue({
      workspaceId: "ws-2",
      name: "HR",
      type: "shared",
      ownerMemberId: "m-owner",
      myEffectiveLevel: "view",
      access: [{ subjectType: "EVERYONE", subjectId: undefined, level: "VIEW" }],
    });
    updateWorkspaceApiMock.mockResolvedValue({
      workspaceId: "ws-2",
      name: "HR Updated",
      type: "shared",
      ownerMemberId: "m-owner",
      myEffectiveLevel: "view",
    });
    setWorkspaceAccessApiMock.mockResolvedValue({
      workspaceId: "ws-2",
      name: "HR Updated",
      type: "shared",
      ownerMemberId: "m-owner",
      myEffectiveLevel: "edit",
    });

    render(<AdminWorkspacesTab />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText("HR 설정 편집"));
    });
    await vi.waitFor(() => {
      expect(getWorkspaceApiMock).toHaveBeenCalledWith("ws-2");
    });
    const nameInput = screen.getAllByPlaceholderText("워크스페이스 이름")[0];
    if (!nameInput) throw new Error("워크스페이스 이름 입력창이 없습니다.");
    fireEvent.change(nameInput, {
      target: { value: "HR Updated" },
    });
    // 규칙 추가 폼 열기 후 TEAM 규칙 추가 (EVERYONE은 이미 존재하여 dedup 처리됨)
    fireEvent.click(screen.getByText("규칙 추가"));
    const editSelects = screen.getAllByRole("combobox");
    const editAddTypeSelect = editSelects.find((s) =>
      Array.from(s.querySelectorAll("option")).some((o) => (o as HTMLOptionElement).value === "TEAM"),
    );
    const editAddLevelSelect = editSelects.find((s) =>
      Array.from(s.querySelectorAll("option")).some((o) => (o as HTMLOptionElement).value === "EDIT"),
    );
    if (editAddTypeSelect) fireEvent.change(editAddTypeSelect, { target: { value: "TEAM" } });
    if (editAddLevelSelect) fireEvent.change(editAddLevelSelect, { target: { value: "EDIT" } });
    // 팀 검색 후 선택
    const teamSearchInput = screen.getByPlaceholderText("팀 검색...");
    fireEvent.change(teamSearchInput, { target: { value: "Core" } });
    fireEvent.click(screen.getByText("Core"));
    fireEvent.click(screen.getByText("추가"));

    await act(async () => {
      fireEvent.click(screen.getByText("저장"));
    });

    await vi.waitFor(() => {
      expect(updateWorkspaceApiMock).toHaveBeenCalledTimes(1);
      expect(setWorkspaceAccessApiMock).toHaveBeenCalledTimes(1);
    });
    expect(updateWorkspaceApiMock).toHaveBeenCalledWith({
      workspaceId: "ws-2",
      name: "HR Updated",
    });
    expect(setWorkspaceAccessApiMock).toHaveBeenCalledWith({
      workspaceId: "ws-2",
      entries: [
        { subjectType: "TEAM", subjectId: "t-1", level: "EDIT" },
        { subjectType: "EVERYONE", subjectId: undefined, level: "VIEW" },
      ],
    });
  });

  it("삭제 확인 시 deleteWorkspace 호출 후 목록에서 제거한다", async () => {
    deleteWorkspaceApiMock.mockResolvedValue(true);

    render(<AdminWorkspacesTab />);
    fireEvent.click(screen.getByLabelText("HR 삭제"));
    fireEvent.change(screen.getByPlaceholderText("HR 삭제"), {
      target: { value: "HR 삭제" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "삭제 실행" }));
    });

    await vi.waitFor(() => {
      expect(deleteWorkspaceApiMock).toHaveBeenCalledWith("ws-2");
    });
    expect(screen.queryByText("HR")).toBeNull();
  });
});
