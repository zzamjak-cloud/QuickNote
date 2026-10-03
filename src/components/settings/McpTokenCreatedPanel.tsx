// 발급 직후 1회 표시 패널 — 토큰 원문과 셸별 연결 스니펫. 닫으면 원문은 상태에서 제거된다.
import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { McpCommandBlock, McpCopyButton } from "./McpCommandBlock";
import { buildPatSnippets, defaultPatShell, PAT_SHELLS, type PatShell } from "./mcpPatSnippets";

export const MCP_URL_PLACEHOLDER = "<MCP 서버 URL>";

type Props = {
  token: string;
  serverUrl: string;
  onClose: () => void;
};

export function McpTokenCreatedPanel({ token, serverUrl, onClose }: Props) {
  const url = serverUrl || MCP_URL_PLACEHOLDER;
  const [shell, setShell] = useState<PatShell>(() => defaultPatShell(navigator.userAgent));

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

      <div role="tablist" aria-label="셸 선택" className="flex flex-wrap gap-1">
        {PAT_SHELLS.map((sh) => (
          <button
            key={sh.id}
            type="button"
            role="tab"
            id={`mcp-pat-tab-${sh.id}`}
            aria-selected={shell === sh.id}
            aria-controls="mcp-pat-snippets"
            onClick={() => setShell(sh.id)}
            className={`min-h-[44px] rounded-md border px-2 text-xs md:min-h-0 md:py-1 ${
              shell === sh.id
                ? "border-violet-400 bg-violet-100 text-violet-800 dark:border-violet-600 dark:bg-violet-900/40 dark:text-violet-200"
                : "border-zinc-200 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            }`}
          >
            {sh.label}
          </button>
        ))}
      </div>

      <div id="mcp-pat-snippets" role="tabpanel" aria-labelledby={`mcp-pat-tab-${shell}`} className="space-y-4">
        {buildPatSnippets(shell, url, token).map((s) => (
          <McpCommandBlock key={s.id} label={s.label} text={s.text} hint={s.hint} />
        ))}
      </div>

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
