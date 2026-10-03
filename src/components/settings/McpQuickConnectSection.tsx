// 설정 > AI 연결(MCP) 맨 위 — Claude Code·Codex 를 OAuth 로 연결하는 명령 안내.
// 명령에는 토큰이 들어가지 않는다: 등록 후 브라우저 로그인으로 PC 별 "연결된 앱"이 생긴다.
import { McpCommandBlock } from "./McpCommandBlock";

function buildQuickConnectCommands(url: string) {
  const claude = `claude mcp add --transport http -s user quicknote ${url}`;
  const codex = `codex mcp add quicknote --url ${url}`;
  return {
    claude,
    codex,
    codexLogin: "codex mcp login quicknote",
    combined: `${claude} && ${codex}`,
  };
}

type Props = {
  serverUrl: string;
};

export function McpQuickConnectSection({ serverUrl }: Props) {
  const cmd = buildQuickConnectCommands(serverUrl);

  return (
    <section
      aria-label="Claude Code·Codex 연결"
      aria-disabled={!serverUrl || undefined}
      className="space-y-3 rounded-md border border-sky-200 bg-sky-50/40 p-3 dark:border-sky-900 dark:bg-sky-950/20"
    >
      <div>
        <h3 className="text-sm font-semibold">Claude Code·Codex 연결 (권장)</h3>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          토큰 없이 명령 한 줄과 브라우저 로그인으로 연결합니다.
        </p>
      </div>

      {serverUrl ? (
        <>
          <McpCommandBlock
            label="Claude Code"
            text={cmd.claude}
            hint="등록 후 Claude Code 세션에서 /mcp → quicknote → Authenticate"
          />
          <McpCommandBlock
            label="Codex CLI"
            text={cmd.codex}
            hint="등록 중 브라우저 로그인이 자동으로 열립니다."
          />
          <McpCommandBlock
            label="Codex 로그인 (자동으로 열리지 않았을 때)"
            text={cmd.codexLogin}
          />
          <McpCommandBlock label="두 도구 한 번에 등록" text={cmd.combined} />
          <ul className="list-disc space-y-1 pl-4 text-xs text-zinc-500 dark:text-zinc-400">
            <li>로그인하면 이 PC 가 아래 "연결된 앱" 목록에 나타납니다.</li>
            <li>PC 마다 따로 연결하고, 따로 해제할 수 있습니다.</li>
            <li>Claude.ai 웹 커넥터는 조직 관리자 등록이 필요합니다.</li>
          </ul>
        </>
      ) : (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          이 빌드에 MCP 서버 주소(VITE_MCP_SERVER_URL)가 설정되어 있지 않아 빠른 연결을 사용할 수 없습니다.
          관리자에게 문의하거나 아래 고급 영역의 개인 액세스 토큰을 사용하세요.
        </p>
      )}
    </section>
  );
}
