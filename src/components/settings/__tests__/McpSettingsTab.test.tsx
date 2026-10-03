import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

const MCP_URL = "https://mcp.example.com/mcp";

/** PAT 는 접힌 "고급" 영역 안에 있다. */
function openPat() {
  fireEvent.click(screen.getByRole("button", { name: /고급: 개인 액세스 토큰/ }));
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
    openPat();

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
    openPat();
    await screen.findByText("발급된 토큰이 없습니다");

    fireEvent.change(screen.getByPlaceholderText(/내 노트북/), { target: { value: "새 토큰" } });
    fireEvent.click(screen.getByRole("button", { name: "토큰 발급" }));

    const tokenInput = (await screen.findByLabelText("발급된 토큰", { selector: "input" })) as HTMLInputElement;
    expect(tokenInput.value).toBe(PLAINTEXT);
    expect(screen.getByText(/이 창을 닫으면 다시 볼 수 없습니다/)).toBeTruthy();
    // 셸 명령에는 원문 대신 환경변수 참조, 원문은 ~/.zshenv 줄에만
    const claudeSnippet = screen.getByText(/claude mcp add-json -s user quicknote/).textContent ?? "";
    expect(claudeSnippet).toContain('"Authorization":"Bearer ${QUICKNOTE_MCP_TOKEN}"');
    expect(claudeSnippet).not.toContain(PLAINTEXT);
    const codexSnippet = screen.getByText(/--bearer-token-env-var QUICKNOTE_MCP_TOKEN/).textContent ?? "";
    expect(codexSnippet).not.toContain(PLAINTEXT);
    expect(screen.getByText(`export QUICKNOTE_MCP_TOKEN="${PLAINTEXT}"`)).toBeTruthy();

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
    openPat();
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
    openPat();

    fireEvent.click(await screen.findByRole("button", { name: "노트북 Claude 토큰 폐기" }));
    fireEvent.click(screen.getByRole("button", { name: "폐기" }));

    await screen.findByText("폐기됨");
    const revokeCall = graphqlMock.mock.calls.find(([arg]) => arg.query.includes("revokeMcpToken"));
    expect(revokeCall?.[0].variables).toEqual({ tokenId: "t1" });
  });

  it("OAuth 연결은 '연결된 앱'에 앱 이름·마지막 사용 시각으로 묶고 연결 해제로 폐기한다", async () => {
    const app = {
      ...baseToken,
      tokenId: "fam-1",
      kind: "oauth",
      name: "Codex",
      tokenHint: "",
      scopes: ["read", "write"],
      lastUsedAt: "2026-10-02T05:30:00.000Z",
    };
    respond({
      listMcpTokens: () => [app, baseToken],
      revokeMcpToken: (vars) => ({ ...app, tokenId: vars.tokenId, revokedAt: "2026-10-03T00:00:00.000Z" }),
    });
    render(<McpSettingsTab />);

    const appsSection = (await screen.findByText("Codex")).closest("section") as HTMLElement;
    expect(within(appsSection).getByRole("heading", { name: "연결된 앱" })).toBeTruthy();
    expect(within(appsSection).getByText(/마지막 사용 2026/)).toBeTruthy();
    expect(within(appsSection).queryByText("…")).toBeNull();
    // PAT 는 연결된 앱에 섞이지 않고 접힌 고급 영역에만 있다
    expect(within(appsSection).queryByText("노트북 Claude")).toBeNull();
    expect(screen.getByText("노트북 Claude").closest("[hidden]")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Codex 연결 해제" }));
    fireEvent.click(await screen.findByRole("button", { name: "연결 해제" }));

    expect(await screen.findByText("연결 해제됨")).toBeTruthy();
    expect(graphqlMock).toHaveBeenCalledWith(
      expect.objectContaining({ variables: { tokenId: "fam-1" } }),
    );
  });

  it("연결된 앱이 없으면 빈 안내를 보여 준다", async () => {
    respond({ listMcpTokens: () => [baseToken] });
    render(<McpSettingsTab />);
    expect(await screen.findByText("연결된 앱이 없습니다")).toBeTruthy();
  });

  it("PAT 영역은 기본으로 접혀 있고 펼치면 발급 폼이 보인다", async () => {
    respond({ listMcpTokens: () => [baseToken] });
    render(<McpSettingsTab />);
    const toggle = screen.getByRole("button", { name: /고급: 개인 액세스 토큰/ });
    await screen.findByText("연결된 앱이 없습니다");

    // 접혀 있어도 패널은 렌더되어 aria-controls 가 실제 요소를 가리킨다
    const panel = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(panel).toBeTruthy();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(panel?.hidden).toBe(true);
    expect(toggle.textContent).toContain("활성 1개");
    expect(screen.queryByRole("button", { name: "토큰 발급" })).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(panel?.hidden).toBe(false);
    expect(screen.getByRole("button", { name: "토큰 발급" })).toBeTruthy();
    expect(screen.getByText("노트북 Claude")).toBeTruthy();

    fireEvent.click(toggle);
    expect(panel?.hidden).toBe(true);
    expect(screen.queryByRole("button", { name: "토큰 발급" })).toBeNull();
  });

  it("빠른 연결 섹션은 토큰 없는 등록 명령과 복사 버튼을 제공한다", async () => {
    vi.stubEnv("VITE_MCP_SERVER_URL", MCP_URL);
    respond({ listMcpTokens: () => [] });
    render(<McpSettingsTab />);
    await screen.findByText("연결된 앱이 없습니다");

    const section = screen.getByRole("region", { name: "Claude Code·Codex 연결" });
    expect(within(section).getByRole("heading", { name: "Claude Code·Codex 연결 (권장)" })).toBeTruthy();
    const claude = `claude mcp add --transport http -s user quicknote "${MCP_URL}"`;
    const codex = `codex mcp add quicknote --url "${MCP_URL}"`;
    expect(within(section).getByText(claude)).toBeTruthy();
    expect(within(section).getByText(codex)).toBeTruthy();
    expect(within(section).getByText("codex mcp login quicknote")).toBeTruthy();
    expect(within(section).getByText(`${claude} && ${codex}`)).toBeTruthy();
    expect(within(section).getByText(/\/mcp → quicknote → Authenticate/)).toBeTruthy();
    expect(within(section).getByText(/PC 마다 따로 연결하고, 따로 해제할 수 있습니다/)).toBeTruthy();
    expect(within(section).getByText(/조직 관리자 등록이 필요합니다/)).toBeTruthy();
    expect(section.textContent).not.toMatch(/Bearer|qn_pat_/);

    fireEvent.click(within(section).getByRole("button", { name: "두 도구 한 번에 등록 복사" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${claude} && ${codex}`);
    fireEvent.click(within(section).getByRole("button", { name: "Codex CLI 복사" }));
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(codex);
  });

  it("MCP 서버 URL 이 없으면 빠른 연결 섹션은 안내만 보여 준다", async () => {
    respond({ listMcpTokens: () => [] });
    render(<McpSettingsTab />);
    await screen.findByText("연결된 앱이 없습니다");

    const section = screen.getByRole("region", { name: "Claude Code·Codex 연결" });
    expect(section.getAttribute("aria-disabled")).toBe("true");
    expect(within(section).getByText(/VITE_MCP_SERVER_URL/)).toBeTruthy();
    expect(within(section).queryByRole("button")).toBeNull();
    expect(section.textContent).not.toContain("claude mcp add");
  });

  it("MCP 서버 URL 이 없으면 스니펫에 자리표시자를 쓴다", async () => {
    respond({
      listMcpTokens: () => [],
      createMcpToken: () => ({ ...baseToken, token: PLAINTEXT }),
    });
    render(<McpSettingsTab />);
    openPat();
    await screen.findByText("발급된 토큰이 없습니다");

    fireEvent.change(screen.getByPlaceholderText(/내 노트북/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "토큰 발급" }));

    const snippet = await screen.findByText(/codex mcp add quicknote --url/);
    expect(snippet.textContent).toContain('--url "<MCP 서버 URL>" --bearer-token-env-var');
  });

  it("PAT 스니펫을 셸별 탭(zsh·bash·PowerShell)으로 나누고 셸 명령에는 원문을 넣지 않는다", async () => {
    vi.stubEnv("VITE_MCP_SERVER_URL", MCP_URL);
    respond({
      listMcpTokens: () => [],
      createMcpToken: () => ({ ...baseToken, token: PLAINTEXT }),
    });
    render(<McpSettingsTab />);
    openPat();
    await screen.findByText("발급된 토큰이 없습니다");
    fireEvent.change(screen.getByPlaceholderText(/내 노트북/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "토큰 발급" }));

    const zshTab = await screen.findByRole("tab", { name: "macOS·Linux (zsh)" });
    expect(zshTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("~/.zshenv 에 추가")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "bash" }));
    expect(screen.getByText("~/.bashrc 에 추가")).toBeTruthy();
    expect(screen.getByText(`export QUICKNOTE_MCP_TOKEN="${PLAINTEXT}"`)).toBeTruthy();
    expect(screen.getByText(/claude mcp add-json -s user quicknote/)).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Windows PowerShell" }));
    expect(screen.getByText(`setx QUICKNOTE_MCP_TOKEN "${PLAINTEXT}"`)).toBeTruthy();
    expect(screen.getByText(/새 터미널을 열고/)).toBeTruthy();
    const psClaude = within(screen.getByRole("tabpanel")).getByText(/claude mcp add --transport http/).textContent ?? "";
    expect(psClaude).toBe(
      `claude mcp add --transport http -s user quicknote "${MCP_URL}" --header 'Authorization: Bearer \${QUICKNOTE_MCP_TOKEN}'`,
    );
    expect(within(screen.getByRole("tabpanel")).getByText(/--bearer-token-env-var/).textContent).not.toContain(PLAINTEXT);
  });

  it("MCP 서버 URL 이 있으면 스니펫에 그대로 넣는다", async () => {
    vi.stubEnv("VITE_MCP_SERVER_URL", MCP_URL);
    respond({
      listMcpTokens: () => [],
      createMcpToken: () => ({ ...baseToken, token: PLAINTEXT }),
    });
    render(<McpSettingsTab />);
    openPat();
    await screen.findByText("발급된 토큰이 없습니다");

    fireEvent.change(screen.getByPlaceholderText(/내 노트북/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "토큰 발급" }));

    await waitFor(() =>
      expect(screen.getByText(/"url": "https:\/\/mcp.example.com\/mcp"/)).toBeTruthy(),
    );
  });
});
