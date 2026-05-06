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

  it("생성 모달에서 중복 대상 권한은 edit 우선 정리 후 생성한다", async () => {
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

    fireEvent.change(screen.getByLabelText("subject-type"), {
      target: { value: "EVERYONE" },
    });
    fireEvent.click(screen.getByText("보기 권한 추가"));
    fireEvent.click(screen.getByText("편집 권한 추가"));
    expect(screen.getByText("같은 대상의 view/edit 중복은 edit 우선으로 정리되었습니다.")).toBeTruthy();

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
    fireEvent.click(screen.getByText("편집 권한 추가"));

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
      entries: [{ subjectType: "EVERYONE", subjectId: undefined, level: "EDIT" }],
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
