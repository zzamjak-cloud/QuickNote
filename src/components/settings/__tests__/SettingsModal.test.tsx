import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { SettingsModal } from "../SettingsModal";
import { useMemberStore } from "../../../store/memberStore";

describe("SettingsModal role tabs", () => {
  beforeEach(() => {
    useMemberStore.setState({
      me: null,
      members: [],
      mentionCandidates: [],
      mentionQuery: "",
    });
  });

  it("member 권한은 내 프로필/로그아웃만 보인다", () => {
    useMemberStore.setState({
      me: {
        memberId: "m1",
        email: "m1@x.com",
        name: "User",
        jobRole: "Engineer",
        workspaceRole: "member",
        status: "active",
        personalWorkspaceId: "ws-1",
      },
    });

    render(<SettingsModal open onClose={() => {}} />);
    expect(screen.getAllByText("내 프로필").length).toBeGreaterThan(0);
    expect(screen.getByText("로그아웃")).toBeTruthy();
    expect(screen.queryByText("구성원")).toBeNull();
    expect(screen.queryByText("팀")).toBeNull();
    expect(screen.queryByText("워크스페이스")).toBeNull();
  });

  it("owner/manager 권한은 관리 탭이 추가로 보인다", () => {
    useMemberStore.setState({
      me: {
        memberId: "m2",
        email: "m2@x.com",
        name: "Owner",
        jobRole: "Lead",
        workspaceRole: "owner",
        status: "active",
        personalWorkspaceId: "ws-2",
      },
    });

    render(<SettingsModal open onClose={() => {}} />);
    expect(screen.getByText("구성원")).toBeTruthy();
    expect(screen.getByText("팀")).toBeTruthy();
    expect(screen.getByText("워크스페이스")).toBeTruthy();
  });
});
