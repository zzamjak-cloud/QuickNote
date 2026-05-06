import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemberRowActions } from "../MemberRowActions";

const promoteMock = vi.fn();
const demoteMock = vi.fn();
const removeMock = vi.fn();

vi.mock("../../../lib/sync/memberApi", () => ({
  promoteToManagerApi: (id: string) => promoteMock(id),
  demoteToMemberApi: (id: string) => demoteMock(id),
  removeMemberApi: (id: string) => removeMock(id),
}));

const member = {
  memberId: "m1",
  email: "m1@x.com",
  name: "Alice",
  jobRole: "Engineer",
  workspaceRole: "member" as const,
  status: "active" as const,
  personalWorkspaceId: "ws-1",
};

describe("MemberRowActions", () => {
  beforeEach(() => {
    promoteMock.mockReset();
    demoteMock.mockReset();
    removeMock.mockReset();
  });

  it("owner는 승격/제거 아이콘 액션을 수행할 수 있다", async () => {
    promoteMock.mockResolvedValue({ ...member, workspaceRole: "manager" });
    const onUpdated = vi.fn();
    const onRemoved = vi.fn();

    render(
      <MemberRowActions
        meRole="owner"
        member={member}
        onMemberUpdated={onUpdated}
        onMemberRemoved={onRemoved}
      />,
    );

    fireEvent.click(screen.getByLabelText(`${member.name} 승격`));
    fireEvent.click(screen.getByText("확인"));

    await waitFor(() => expect(promoteMock).toHaveBeenCalledTimes(1));
    expect(onUpdated).toHaveBeenCalled();
    expect(screen.getByLabelText(`${member.name} 제거`)).toBeTruthy();
  });

  it("manager도 승격/제거 액션을 수행할 수 있다", async () => {
    promoteMock.mockResolvedValue({ ...member, workspaceRole: "manager" });
    const onUpdated = vi.fn();
    const onRemoved = vi.fn();
    render(
      <MemberRowActions
        meRole="manager"
        member={member}
        onMemberUpdated={onUpdated}
        onMemberRemoved={onRemoved}
      />,
    );

    fireEvent.click(screen.getByLabelText(`${member.name} 승격`));
    fireEvent.click(screen.getByText("확인"));
    await waitFor(() => expect(promoteMock).toHaveBeenCalledTimes(1));
    expect(onUpdated).toHaveBeenCalled();
    expect(onRemoved).not.toHaveBeenCalled();
  });
});
