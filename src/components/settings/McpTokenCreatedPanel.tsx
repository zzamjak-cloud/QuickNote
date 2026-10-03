// 발급 직후 1회 표시 패널 — 토큰 원문과 클라이언트별 연결 스니펫. 닫으면 원문은 상태에서 제거된다.
import { Copy, TriangleAlert } from "lucide-react";
import { useUiStore } from "../../store/uiStore";

export const MCP_URL_PLACEHOLDER = "<MCP 서버 URL>";

type Props = {
  token: string;
  serverUrl: string;
  onClose: () => void;
};

function buildSnippets(url: string, token: string) {
  return [
    {
      id: "claude-code",
      label: "Claude Code",
      text: `claude mcp add --transport http quicknote ${url} --header "Authorization: Bearer ${token}"`,
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
  const showToast = useUiStore((s) => s.showToast);
  const url = serverUrl || MCP_URL_PLACEHOLDER;

  const copy = (text: string, label: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => showToast(`${label} 복사됨`))
      .catch(() => showToast("클립보드 복사에 실패했습니다", { kind: "error" }));
  };

  const copyButton = (text: string, label: string) => (
    <button
      type="button"
      onClick={() => copy(text, label)}
      className="flex min-h-[44px] shrink-0 items-center gap-1 rounded-md border border-zinc-200 px-2 text-xs hover:bg-zinc-100 md:min-h-0 md:py-1 dark:border-zinc-700 dark:hover:bg-zinc-800"
      aria-label={`${label} 복사`}
    >
      <Copy size={12} aria-hidden />
      복사
    </button>
  );

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
        {copyButton(token, "토큰")}
      </div>

      {!serverUrl && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          이 빌드에 MCP 서버 주소(VITE_MCP_SERVER_URL)가 설정되어 있지 않습니다.
          스니펫의 {MCP_URL_PLACEHOLDER} 를 실제 주소로 바꿔 사용하세요.
        </p>
      )}

      {buildSnippets(url, token).map((s) => (
        <div key={s.id} className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-medium text-zinc-600 dark:text-zinc-300">{s.label}</h4>
            {copyButton(s.text, s.label)}
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-zinc-900 p-2 font-mono text-[11px] text-zinc-100">
            {s.text}
          </pre>
        </div>
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
