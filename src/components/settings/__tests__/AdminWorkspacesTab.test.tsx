import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminWorkspacesTab } from "../AdminWorkspacesTab";
import { useWorkspaceStore } from "../../../store/workspaceStore";
import { useMemberStore } from "../../../store/memberStore";
import { useTeamStore } from "../../../store/teamStore";
import { useWorkspaceAccessCacheStore } from "../../../store/workspaceAccessCacheStore";

const createWorkspaceApiMock = vi.fn();
const updateWorkspaceApiMock = vi.fn();
const setWorkspaceAccessApiMock = vi.fn();
const deleteWorkspaceApiMock = vi.fn();
const getWorkspaceApiMock = vi.fn();
const archiveWorkspaceApiMock = vi.fn();
const listMyWorkspacesApiMock = vi.fn();

vi.mock("../../../lib/sync/workspaceApi", () => ({
  createWorkspaceApi: (...args: unknown[]) => createWorkspaceApiMock(...args),
  updateWorkspaceApi: (...args: unknown[]) => updateWorkspaceApiMock(...args),
  setWorkspaceAccessApi: (...args: unknown[]) => setWorkspaceAccessApiMock(...args),
  deleteWorkspaceApi: (...args: unknown[]) => deleteWorkspaceApiMock(...args),
  getWorkspaceApi: (...args: unknown[]) => getWorkspaceApiMock(...args),
  archiveWorkspaceApi: (...args: unknown[]) => archiveWorkspaceApiMock(...args),
  listMyWorkspacesApi: (...args: unknown[]) => listMyWorkspacesApiMock(...args),
}));

describe("AdminWorkspacesTab", () => {
  beforeEach(() => {
    createWorkspaceApiMock.mockReset();
    updateWorkspaceApiMock.mockReset();
    setWorkspaceAccessApiMock.mockReset();
    deleteWorkspaceApiMock.mockReset();
    getWorkspaceApiMock.mockReset();
    archiveWorkspaceApiMock.mockReset();
    listMyWorkspacesApiMock.mockReset();
    // 워크스페이스 접근 캐시는 모듈 상태이므로 테스트 간 누수 방지를 위해 초기화
    useWorkspaceAccessCacheStore.setState({ cache: {} });
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
      teams: [{ teamId: "t-1", name: "Core", leaderMemberIds: [], members: [] }],
    });
  });

  it("공유 워크스페이스 목록만 표시한다", () => {
    render(<AdminWorkspacesTab />);
    expect(screen.queryByText("Personal")).toBeNull();
    expect(screen.getByText("HR")).toBeTruthy();
    expect(screen.getByText("Engineering")).toBeTruthy();
  });

  it("행에 설정 편집 라벨이 있고, 클릭 시 편집 모달에서 보관 버튼에 접근할 수 있다", async () => {
    getWorkspaceApiMock.mockResolvedValue({
      workspaceId: "ws-2",
      name: "HR",
      type: "shared",
      ownerMemberId: "m-owner",
      myEffectiveLevel: "view",
      access: [],
    });
    render(<AdminWorkspacesTab />);
    expect(screen.getAllByLabelText("HR 설정 편집").length).toBeGreaterThan(0);
    await act(async () => {
      fireEvent.click(screen.getByLabelText("HR 설정 편집"));
    });
    await vi.waitFor(() => {
      expect(getWorkspaceApiMock).toHaveBeenCalledWith("ws-2");
    });
    expect(screen.getByRole("button", { name: "보관함으로 이동" })).toBeTruthy();
  });

  it("생성 모달에서 워크스페이스를 생성한다", async () => {
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

    await act(async () => {
      fireEvent.click(screen.getByText("저장"));
    });

    await vi.waitFor(() => {
      expect(createWorkspaceApiMock).toHaveBeenCalledTimes(1);
    });
    expect(createWorkspaceApiMock).toHaveBeenCalledWith({
      name: "New WS",
      access: [],
    });
  });

  it("생성 응답이 실패해도 재조회에서 새 워크스페이스가 확인되면 성공 처리한다", async () => {
    const existingWorkspaces = useWorkspaceStore.getState().workspaces;
    createWorkspaceApiMock.mockRejectedValue(new Error("저장에 실패했습니다."));
    listMyWorkspacesApiMock.mockResolvedValue([
      ...existingWorkspaces,
      {
        workspaceId: "ws-9",
        name: "Recovered WS",
        type: "shared",
        ownerMemberId: "m-owner",
        myEffectiveLevel: "edit",
        createdAt: "2026-06-09T00:00:00.000Z",
      },
    ]);

    render(<AdminWorkspacesTab />);

    fireEvent.click(screen.getByText("워크스페이스 생성"));
    fireEvent.change(screen.getByPlaceholderText("워크스페이스 이름"), {
      target: { value: "Recovered WS" },
    });

    await act(async () => {
      fireEvent.click(screen.getByText("저장"));
    });

    await vi.waitFor(() => {
      expect(listMyWorkspacesApiMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByLabelText("Recovered WS 설정 편집")).toBeTruthy();
    expect(screen.queryByText("저장에 실패했습니다.")).toBeNull();
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
      entries: [{ subjectType: "EVERYONE", subjectId: undefined, level: "VIEW" }],
    });
  });

  it("보관함 이동 클릭 시 archiveWorkspace 호출 후 활성 목록에서 제거한다", async () => {
    archiveWorkspaceApiMock.mockResolvedValue({
      workspaceId: "ws-2",
      name: "HR",
      type: "shared",
      ownerMemberId: "m-owner",
      myEffectiveLevel: "view",
      removedAt: "2026-05-18T00:00:00.000Z",
    });
    getWorkspaceApiMock.mockResolvedValue({
      workspaceId: "ws-2",
      name: "HR",
      type: "shared",
      ownerMemberId: "m-owner",
      myEffectiveLevel: "view",
      access: [],
    });

    render(<AdminWorkspacesTab />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText("HR 설정 편집"));
    });
    await vi.waitFor(() => {
      expect(getWorkspaceApiMock).toHaveBeenCalled();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "보관함으로 이동" }));
    });

    await vi.waitFor(() => {
      expect(archiveWorkspaceApiMock).toHaveBeenCalledWith("ws-2");
    });
    expect(screen.queryByText("HR")).toBeNull();
  });
});
