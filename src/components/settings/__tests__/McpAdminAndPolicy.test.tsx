// MCP 관리자 토큰 관리 섹션·관리자 폐기 표시·워크스페이스 MCP 정책(선택·발급 폼 반영).
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpSettingsTab } from "../McpSettingsTab";
import { useMemberStore } from "../../../store/memberStore";
import { useWorkspaceStore } from "../../../store/workspaceStore";

const graphqlMock = vi.fn();
vi.mock("../../../lib/sync/graphql/client", () => ({
  appsyncClient: () => ({ graphql: graphqlMock }),
}));

const baseToken = {
  tokenId: "t1", kind: "pat", name: "노트북 Claude", scopes: ["read"], workspaceIds: [], tokenHint: "abcd",
  createdAt: "2026-09-01T00:00:00.000Z", expiresAt: null, lastUsedAt: null, revokedAt: null, revokedByAdmin: false, revokeReason: null,
};
const adminToken = {
  tokenId: "a1", kind: "pat", name: "Bob laptop", clientName: null, memberId: "m2", memberName: "Bob", memberEmail: "bob@example.com",
  scopes: ["read", "write"], workspaceIds: ["ws-1"], workspaces: [{ workspaceId: "ws-1", name: "팀" }], tokenHint: "wxyz",
  status: "active", createdAt: "2026-09-02T00:00:00.000Z", expiresAt: null, lastUsedAt: null, revokedAt: null, revokedBy: null, revokeReason: null,
};

function respond(handlers: Record<string, (vars: Record<string, unknown>) => unknown>) {
  graphqlMock.mockImplementation(async ({ query, variables }: { query: string; variables: Record<string, unknown> }) => {
    const field = Object.keys(handlers).find((name) => query.includes(`${name}(`) || query.includes(`${name} {`));
    if (!field) throw new Error(`unexpected query: ${query}`);
    return { data: { [field]: handlers[field](variables) } };
  });
}

function asMember(role: string) {
  useMemberStore.setState({
    me: { memberId: "me", name: "Me", email: "me@example.com", workspaceRole: role, personalWorkspaceId: "ws-p", status: "active" } as never,
    members: [{ memberId: "m2", name: "Bob", email: "bob@example.com", status: "active" } as never],
  });
}

beforeEach(() => {
  graphqlMock.mockReset();
  vi.stubEnv("VITE_MCP_SERVER_URL", "");
  useWorkspaceStore.setState({
    currentWorkspaceId: "ws-1",
    workspaces: [
      { workspaceId: "ws-p", name: "개인", type: "personal", ownerMemberId: "me", myEffectiveLevel: "edit", mcpPolicy: "readWrite" },
      { workspaceId: "ws-1", name: "팀", type: "shared", ownerMemberId: "x", myEffectiveLevel: "edit", mcpPolicy: "read" },
      { workspaceId: "ws-off", name: "보안", type: "shared", ownerMemberId: "x", myEffectiveLevel: "edit", mcpPolicy: "disabled" },
    ],
  });
});
/** PAT 는 접힌 "고급" 영역 안에 있다. */
function openPat() {
  fireEvent.click(screen.getByRole("button", { name: /고급: 개인 액세스 토큰/ }));
}

afterEach(() => {
  vi.unstubAllEnvs();
  useMemberStore.setState({ me: null, members: [] });
});

describe("토큰 관리(관리자)", () => {
  it("일반 구성원에게는 토큰 관리 섹션이 없고, 관리자 폐기된 토큰은 표시·사유를 보여 준다", async () => {
    asMember("member");
    respond({ listMcpTokens: () => [{ ...baseToken, revokedAt: "2026-10-01T00:00:00.000Z", revokedByAdmin: true, revokeReason: "퇴사" }] });
    render(<McpSettingsTab />);
    openPat();
    expect(await screen.findByText("관리자에 의해 폐기됨")).toBeTruthy();
    expect(screen.getByText("폐기 사유: 퇴사")).toBeTruthy();
    expect(screen.queryByText("토큰 관리")).toBeNull();
    expect(graphqlMock.mock.calls.some(([a]) => a.query.includes("adminListMcpTokens"))).toBe(false);
  });

  it.each(["leader", "manager"])("%s 에게는 토큰 관리 섹션이 없다(MCP 관리자 = developer·owner)", async (role) => {
    asMember(role);
    respond({ listMcpTokens: () => [] });
    render(<McpSettingsTab />);
    await screen.findByText("연결된 앱이 없습니다");
    expect(screen.queryByText("토큰 관리")).toBeNull();
    expect(graphqlMock.mock.calls.some(([a]) => a.query.includes("adminListMcpTokens"))).toBe(false);
  });

  it("developer 는 현황을 보고 사유와 함께 강제 폐기한다", async () => {
    asMember("developer");
    respond({
      listMcpTokens: () => [],
      adminListMcpTokens: () => ({ items: [adminToken], nextToken: null }),
      adminRevokeMcpToken: (v) => ({ ...adminToken, status: "revoked", revokedAt: "2026-10-03T00:00:00.000Z", revokeReason: v.reason }),
    });
    render(<McpSettingsTab />);
    expect(await screen.findByText("Bob laptop")).toBeTruthy();
    const listCall = graphqlMock.mock.calls.find(([a]) => a.query.includes("adminListMcpTokens"));
    expect(listCall?.[0].variables.filter).toEqual({ status: "active" });

    fireEvent.click(screen.getByRole("button", { name: "Bob laptop 강제 폐기" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByPlaceholderText(/퇴사/), { target: { value: "기기 분실" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "폐기" }));
    await waitFor(() => expect(graphqlMock.mock.calls.some(([a]) => a.query.includes("adminRevokeMcpToken("))).toBe(true));
    const call = graphqlMock.mock.calls.find(([a]) => a.query.includes("adminRevokeMcpToken("));
    expect(call?.[0].variables).toEqual({ tokenId: "a1", memberId: "m2", reason: "기기 분실" });
    expect(await screen.findByText(/기기 분실/)).toBeTruthy();
  });

  it("구성원을 고르면 그 구성원 토큰·연결을 일괄 폐기할 수 있다", async () => {
    asMember("owner");
    respond({
      listMcpTokens: () => [],
      adminListMcpTokens: () => ({ items: [adminToken], nextToken: null }),
      adminRevokeMcpTokensByMember: (v) => ({ memberId: v.memberId, revokedCount: 1, items: [{ ...adminToken, status: "revoked" }] }),
    });
    render(<McpSettingsTab />);
    await screen.findByText("Bob laptop");
    fireEvent.change(screen.getByLabelText("구성원 필터"), { target: { value: "m2" } });
    fireEvent.click(await screen.findByRole("button", { name: /이 구성원의 토큰·연결 모두 폐기/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "폐기" }));
    await waitFor(() => {
      const call = graphqlMock.mock.calls.find(([a]) => a.query.includes("adminRevokeMcpTokensByMember("));
      expect(call?.[0].variables).toEqual({ memberId: "m2", reason: null });
    });
  });
});

describe("워크스페이스 MCP 정책", () => {
  it("발급 폼은 차단 워크스페이스를 빼고 읽기 전용을 표시한다", async () => {
    asMember("member");
    respond({ listMcpTokens: () => [] });
    render(<McpSettingsTab />);
    openPat();
    await screen.findByText("발급된 토큰이 없습니다");
    const scope = screen.getByText(/워크스페이스 범위/).closest("fieldset") as HTMLElement;
    expect(within(scope).queryByText("보안")).toBeNull();
    expect(within(scope).getByText("팀").parentElement?.textContent).toContain("읽기 전용");
  });

  it("개인 워크스페이스 정책을 바꾸면 setWorkspaceMcpPolicy 로 즉시 저장한다", async () => {
    asMember("member");
    respond({
      listMcpTokens: () => [],
      setWorkspaceMcpPolicy: (v) => ({
        workspaceId: v.workspaceId, name: "개인", type: "PERSONAL", ownerMemberId: "me", myEffectiveLevel: "EDIT",
        createdAt: "x", access: [], options: { jobFunctions: [], jobTitles: [] }, mcpPolicy: v.policy,
      }),
    });
    render(<McpSettingsTab />);
    fireEvent.change(await screen.findByLabelText("AI 연결(MCP) 허용 정책"), { target: { value: "disabled" } });
    await waitFor(() => {
      const call = graphqlMock.mock.calls.find(([a]) => a.query.includes("setWorkspaceMcpPolicy("));
      expect(call?.[0].variables).toEqual({ workspaceId: "ws-p", policy: "disabled" });
    });
    await waitFor(() => expect(useWorkspaceStore.getState().workspaces.find((w) => w.workspaceId === "ws-p")?.mcpPolicy).toBe("disabled"));
  });
});
