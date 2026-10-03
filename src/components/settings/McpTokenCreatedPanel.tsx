// 발급 직후 1회 표시 패널 — 토큰 원문과 클라이언트별 연결 스니펫. 닫으면 원문은 상태에서 제거된다.
// 셸 명령에는 원문을 넣지 않고 환경변수(QUICKNOTE_MCP_TOKEN)를 참조한다 — 셸 히스토리에 토큰이 남지 않게.
import { TriangleAlert } from "lucide-react";
import { McpCommandBlock, McpCopyButton } from "./McpCommandBlock";

export const MCP_URL_PLACEHOLDER = "<MCP 서버 URL>";
export const MCP_TOKEN_ENV = "QUICKNOTE_MCP_TOKEN";

type Props = {
  token: string;
  serverUrl: string;
  onClose: () => void;
};

function buildSnippets(url: string, token: string) {
  const claudeJson = JSON.stringify({ type: "http", url, headers: { Authorization: `Bearer \${${MCP_TOKEN_ENV}}` } });
  return [
    {
      id: "zshenv",
      label: "~/.zshenv 에 추가",
      text: `export ${MCP_TOKEN_ENV}="${token}"`,
      hint: "터미널에 붙여 넣지 말고 편집기로 ~/.zshenv 에 추가한 뒤 chmod 600 ~/.zshenv, 새 터미널을 여세요.",
    },
    {
      id: "claude-code",
      label: "Claude Code",
      text: `claude mcp add-json -s user quicknote '${claudeJson}'`,
    },
    {
      id: "codex",
      label: "Codex CLI",
      text: `codex mcp add quicknote --url ${url} --bearer-token-env-var ${MCP_TOKEN_ENV}`,
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

export function McpTokenCreatedPanel({ token, serverUrl, onClose }: Props) {
  const url = serverUrl || MCP_URL_PLACEHOLDER;

  return (
    <section
      aria-label="발급된 토큰"
      className="space-y-4 rounded-md border border-violet-200 bg-violet-50/50 p-3 dark:border-violet-900 dark:bg-violet-950/20"
    >
      <p className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
        <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
        이 창을 닫으면 다시 볼 수 없습니다. 지금 안전한 곳에 복사해 두세요.
      </p>

      <div className="flex gap-2">
        <input
          type="text"
          readOnly
          value={token}
          aria-label="발급된 토큰"
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-3 py-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
        />
        <McpCopyButton text={token} label="토큰" />
      </div>

      {!serverUrl && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          이 빌드에 MCP 서버 주소(VITE_MCP_SERVER_URL)가 설정되어 있지 않습니다.
          스니펫의 {MCP_URL_PLACEHOLDER} 를 실제 주소로 바꿔 사용하세요.
        </p>
      )}

      {buildSnippets(url, token).map((s) => (
        <McpCommandBlock key={s.id} label={s.label} text={s.text} hint={s.hint} />
      ))}

      <button
        type="button"
        onClick={onClose}
        className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-100 sm:w-auto dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        닫기
      </button>
    </section>
  );
}
