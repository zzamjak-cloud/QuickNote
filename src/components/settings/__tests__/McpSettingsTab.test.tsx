import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpSettingsTab } from "../McpSettingsTab";
import { useWorkspaceStore } from "../../../store/workspaceStore";

const graphqlMock = vi.fn();

vi.mock("../../../lib/sync/graphql/client", () => ({
  appsyncClient: () => ({ graphql: graphqlMock }),
}));

const baseToken = {
  tokenId: "t1",
  name: "노트북 Claude",
  scopes: ["read"],
  workspaceIds: [],
  tokenHint: "abcd",
  createdAt: "2026-09-01T00:00:00.000Z",
  expiresAt: null,
  lastUsedAt: null,
  revokedAt: null,
};

const PLAINTEXT = "qn_pat_SECRETVALUE1234";

function respond(handlers: Record<string, (vars: Record<string, unknown>) => unknown>) {
  graphqlMock.mockImplementation(async ({ query, variables }: { query: string; variables: Record<string, unknown> }) => {
    const field = Object.keys(handlers).find((name) => query.includes(`${name}(`) || query.includes(`${name} {`));
    if (!field) throw new Error(`unexpected query: ${query}`);
    return { data: { [field]: handlers[field](variables) } };
  });
}

describe("McpSettingsTab", () => {
  beforeEach(() => {
    graphqlMock.mockReset();
    vi.stubEnv("VITE_MCP_SERVER_URL", "");
    useWorkspaceStore.setState({
      currentWorkspaceId: "ws-1",
      workspaces: [
        { workspaceId: "ws-1", name: "개인", type: "personal", ownerMemberId: "m1", myEffectiveLevel: "edit" },
      ],
    });
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("토큰 목록을 이름·힌트·범위와 함께 렌더한다", async () => {
    respond({
      listMcpTokens: () => [
        baseToken,
        { ...baseToken, tokenId: "t2", name: "폐기된 토큰", workspaceIds: ["ws-1"], revokedAt: "2026-09-10T00:00:00.000Z" },
      ],
    });
    render(<McpSettingsTab />);

    expect(await screen.findByText("노트북 Claude")).toBeTruthy();
    expect(screen.getAllByText("…abcd").length).toBe(2);
    expect(screen.getByText("전체 워크스페이스")).toBeTruthy();
    expect(screen.getByText("개인", { selector: "p" })).toBeTruthy();
    expect(screen.getByText("폐기됨")).toBeTruthy();
    // 폐기된 토큰에는 폐기 버튼이 없다
    expect(screen.getAllByRole("button", { name: /토큰 폐기$/ }).length).toBe(1);
  });

  it("발급하면 원문을 한 번만 보여 주고 닫으면 지운다", async () => {
    respond({
      listMcpTokens: () => [],
      createMcpToken: () => ({ ...baseToken, tokenId: "t9", name: "새 토큰", token: PLAINTEXT }),
    });
    render(<McpSettingsTab />);
    await screen.findByText("발급된 토큰이 없습니다");

    fireEvent.change(screen.getByPlaceholderText(/내 노트북/), { target: { value: "새 토큰" } });
    fireEvent.click(screen.getByRole("button", { name: "토큰 발급" }));

    const tokenInput = (await screen.findByLabelText("발급된 토큰", { selector: "input" })) as HTMLInputElement;
    expect(tokenInput.value).toBe(PLAINTEXT);
    expect(screen.getByText(/이 창을 닫으면 다시 볼 수 없습니다/)).toBeTruthy();
    expect(screen.getByText(/claude mcp add --transport http quicknote/).textContent).toContain(
      `Bearer ${PLAINTEXT}`,
    );

    const createCall = graphqlMock.mock.calls.find(([arg]) => arg.query.includes("createMcpToken"));
    expect(createCall?.[0].variables).toEqual({
      input: { name: "새 토큰", scopes: ["read"], workspaceIds: [], expiresInDays: 90 },
    });

    fireEvent.click(screen.getByRole("button", { name: "토큰 복사" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(PLAINTEXT);

    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.queryByDisplayValue(PLAINTEXT)).toBeNull();
    expect(document.body.textContent).not.toContain(PLAINTEXT);
    // 목록에는 메타만 남는다
    expect(screen.getByText("새 토큰")).toBeTruthy();
  });

  it("읽기+쓰기를 고르면 경고를 보여 주고 write scope 로 발급한다", async () => {
    respond({
      listMcpTokens: () => [],
      createMcpToken: () => ({ ...baseToken, scopes: ["read", "write"], token: PLAINTEXT }),
    });
    render(<McpSettingsTab />);
    await screen.findByText("발급된 토큰이 없습니다");
    expect(screen.queryByRole("note")).toBeNull();

    fireEvent.change(screen.getByPlaceholderText(/내 노트북/), { target: { value: "쓰기 토큰" } });
    fireEvent.click(screen.getByRole("radio", { name: "읽기+쓰기" }));
    expect(screen.getByRole("note").textContent).toMatch(/휴지통.*영구 삭제는 할 수 없고.*버전 히스토리/s);
    fireEvent.click(screen.getByRole("button", { name: "토큰 발급" }));

    await screen.findByLabelText("발급된 토큰", { selector: "input" });
    const createCall = graphqlMock.mock.calls.find(([arg]) => arg.query.includes("createMcpToken"));
    expect(createCall?.[0].variables.input.scopes).toEqual(["read", "write"]);
  });

  it("폐기 확인 후 revokeMcpToken 을 호출하고 폐기됨으로 표시한다", async () => {
    respond({
      listMcpTokens: () => [baseToken],
      revokeMcpToken: (vars) => ({ ...baseToken, tokenId: vars.tokenId, revokedAt: "2026-10-03T00:00:00.000Z" }),
    });
    render(<McpSettingsTab />);

    fireEvent.click(await screen.findByRole("button", { name: "노트북 Claude 토큰 폐기" }));
    fireEvent.click(screen.getByRole("button", { name: "폐기" }));

    await screen.findByText("폐기됨");
    const revokeCall = graphqlMock.mock.calls.find(([arg]) => arg.query.includes("revokeMcpToken"));
    expect(revokeCall?.[0].variables).toEqual({ tokenId: "t1" });
  });

  it("OAuth 연결 앱은 '연결된 앱' 배지로 보여 주고 연결 해제로 폐기한다", async () => {
    const app = { ...baseToken, tokenId: "fam-1", kind: "oauth", name: "Claude", tokenHint: "", scopes: ["read", "write"] };
    respond({
      listMcpTokens: () => [app],
      revokeMcpToken: (vars) => ({ ...app, tokenId: vars.tokenId, revokedAt: "2026-10-03T00:00:00.000Z" }),
    });
    render(<McpSettingsTab />);

    expect(await screen.findByText("Claude")).toBeTruthy();
    expect(screen.getByText("연결된 앱")).toBeTruthy();
    expect(screen.queryByText("…")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Claude 연결 해제" }));
    fireEvent.click(await screen.findByRole("button", { name: "폐기" }));

    expect(await screen.findByText("폐기됨")).toBeTruthy();
    expect(graphqlMock).toHaveBeenCalledWith(
      expect.objectContaining({ variables: { tokenId: "fam-1" } }),
    );
  });

  it("MCP 서버 URL 이 없으면 스니펫에 자리표시자를 쓴다", async () => {
    respond({
      listMcpTokens: () => [],
      createMcpToken: () => ({ ...baseToken, token: PLAINTEXT }),
    });
    render(<McpSettingsTab />);
    await screen.findByText("발급된 토큰이 없습니다");

    fireEvent.change(screen.getByPlaceholderText(/내 노트북/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "토큰 발급" }));

    const snippet = await screen.findByText(/claude mcp add/);
    expect(snippet.textContent).toContain("quicknote <MCP 서버 URL> --header");
  });

  it("MCP 서버 URL 이 있으면 스니펫에 그대로 넣는다", async () => {
    vi.stubEnv("VITE_MCP_SERVER_URL", "https://mcp.example.com/mcp");
    respond({
      listMcpTokens: () => [],
      createMcpToken: () => ({ ...baseToken, token: PLAINTEXT }),
    });
    render(<McpSettingsTab />);
    await screen.findByText("발급된 토큰이 없습니다");

    fireEvent.change(screen.getByPlaceholderText(/내 노트북/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "토큰 발급" }));

    await waitFor(() =>
      expect(screen.getByText(/"url": "https:\/\/mcp.example.com\/mcp"/)).toBeTruthy(),
    );
  });
});
