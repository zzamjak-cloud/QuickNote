import { describe, expect, it } from "vitest";
import { buildPatSnippets, defaultPatShell, PAT_SHELLS } from "../mcpPatSnippets";

const URL = "https://mcp.example.com/mcp";
const TOKEN = "qn_pat_SECRETVALUE1234";

describe("mcpPatSnippets", () => {
  it("Windows 브라우저는 PowerShell, 그 밖은 zsh 를 기본으로 고른다", () => {
    expect(defaultPatShell("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("powershell");
    expect(defaultPatShell("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)")).toBe("zsh");
    expect(defaultPatShell("Mozilla/5.0 (X11; Linux x86_64)")).toBe("zsh");
    expect(defaultPatShell("")).toBe("zsh");
  });

  it.each(PAT_SHELLS.map((s) => s.id))("%s: 원문은 환경변수 등록 줄·JSON 에만 있고 셸 명령은 환경변수를 참조한다", (shell) => {
    const byId = Object.fromEntries(buildPatSnippets(shell, URL, TOKEN).map((s) => [s.id, s.text]));
    expect(byId.env).toContain(TOKEN);
    expect(byId.json).toContain(TOKEN);
    for (const id of ["claude-code", "codex"]) {
      expect(byId[id]).not.toContain(TOKEN);
      expect(byId[id]).toContain("QUICKNOTE_MCP_TOKEN");
      expect(byId[id]).toContain(URL);
    }
  });

  it("POSIX 셸의 Claude Code 명령은 작은따옴표로 감싼 add-json 이다", () => {
    const claude = buildPatSnippets("zsh", URL, TOKEN).find((s) => s.id === "claude-code")?.text ?? "";
    const json = claude.match(/^claude mcp add-json -s user quicknote '(.*)'$/)?.[1] ?? "";
    expect(JSON.parse(json)).toEqual({
      type: "http",
      url: URL,
      headers: { Authorization: "Bearer ${QUICKNOTE_MCP_TOKEN}" },
    });
  });
});
