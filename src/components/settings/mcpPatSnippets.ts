// PAT 연결 스니펫 — 셸별(zsh·bash·PowerShell)로 환경변수 등록과 Claude Code 명령을 나눈다.
// 셸 명령에는 원문을 넣지 않고 QUICKNOTE_MCP_TOKEN 을 참조한다(셸 히스토리 노출 방지).
// 원문은 환경변수 등록 줄과 JSON 설정 파일 스니펫에만 들어간다.

export const MCP_TOKEN_ENV = "QUICKNOTE_MCP_TOKEN";

export type PatShell = "zsh" | "bash" | "powershell";

export const PAT_SHELLS: { id: PatShell; label: string }[] = [
  { id: "zsh", label: "macOS·Linux (zsh)" },
  { id: "bash", label: "bash" },
  { id: "powershell", label: "Windows PowerShell" },
];

export type PatSnippet = { id: string; label: string; text: string; hint?: string };

/** Windows 브라우저면 PowerShell 탭을 기본으로 연다. */
export function defaultPatShell(userAgent: string): PatShell {
  return /Windows/.test(userAgent) ? "powershell" : "zsh";
}

function envSnippet(shell: PatShell, token: string): PatSnippet {
  if (shell === "powershell") {
    return {
      id: "env",
      label: "사용자 환경변수 등록",
      text: `setx ${MCP_TOKEN_ENV} "${token}"`,
      hint: "실행 후 새 터미널을 열고 Claude Code·Codex 를 다시 시작하세요. 명령 기록에 남기지 않으려면 시스템 속성 > 환경 변수에서 직접 추가해도 됩니다.",
    };
  }
  const file = shell === "zsh" ? "~/.zshenv" : "~/.bashrc";
  return {
    id: "env",
    label: `${file} 에 추가`,
    text: `export ${MCP_TOKEN_ENV}="${token}"`,
    hint: `터미널에 붙여 넣지 말고 편집기로 ${file} 에 추가한 뒤 chmod 600 ${file}, 새 터미널을 여세요.`,
  };
}

function claudeSnippet(shell: PatShell, url: string): PatSnippet {
  const header = `Authorization: Bearer \${${MCP_TOKEN_ENV}}`;
  if (shell === "powershell") {
    // PowerShell 은 버전·실행 경로에 따라 네이티브 인자 안의 큰따옴표(JSON)가 깨지므로
    // add-json 대신 add --header 를 쓴다(저장되는 설정은 add-json 과 같다). 작은따옴표 = ${} 를 그대로 전달.
    return {
      id: "claude-code",
      label: "Claude Code",
      text: `claude mcp add --transport http -s user quicknote "${url}" --header '${header}'`,
    };
  }
  const json = JSON.stringify({ type: "http", url, headers: { Authorization: `Bearer \${${MCP_TOKEN_ENV}}` } });
  return { id: "claude-code", label: "Claude Code", text: `claude mcp add-json -s user quicknote '${json}'` };
}

export function buildPatSnippets(shell: PatShell, url: string, token: string): PatSnippet[] {
  return [
    envSnippet(shell, token),
    claudeSnippet(shell, url),
    {
      id: "codex",
      label: "Codex CLI",
      text: `codex mcp add quicknote --url "${url}" --bearer-token-env-var ${MCP_TOKEN_ENV}`,
    },
    {
      id: "json",
      label: "Cursor / 기타 (JSON)",
      text: JSON.stringify(
        { mcpServers: { quicknote: { url, headers: { Authorization: `Bearer ${token}` } } } },
        null,
        2,
      ),
    },
  ];
}
