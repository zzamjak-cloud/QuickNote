// 본인 MCP 토큰 목록 — OAuth 연결(연결된 앱)과 PAT 를 같은 행 형태로 그린다.
import { Ban } from "lucide-react";
import type { McpToken } from "../../lib/sync/mcpTokenApi";

const SCOPE_LABEL: Record<string, string> = { read: "읽기", write: "쓰기" };

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString("ko-KR");
}

/** 연결된 앱은 PC 별 구분에 시각이 필요하다. */
function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "-"
    : d.toLocaleString("ko-KR", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

type Props = {
  tokens: McpToken[];
  busy: boolean;
  workspaceSummary: (ids: string[]) => string;
  onRevoke: (token: McpToken) => void;
};

export function McpTokenList({ tokens, busy, workspaceSummary, onRevoke }: Props) {
  return (
    <ul className="space-y-2">
      {tokens.map((t) => {
        const isApp = t.kind === "oauth";
        return (
          <li
            key={t.tokenId}
            className={`flex flex-col gap-2 rounded-md border border-zinc-200 p-3 sm:flex-row sm:items-start dark:border-zinc-700 ${
              t.revokedAt ? "opacity-60" : ""
            }`}
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium">{t.name}</span>
                {!isApp && <span className="font-mono text-xs text-zinc-400">…{t.tokenHint}</span>}
                {t.scopes.map((s) => (
                  <span
                    key={s}
                    className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
                  >
                    {SCOPE_LABEL[s] ?? s}
                  </span>
                ))}
                {t.revokedAt && (
                  <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] text-red-700 dark:bg-red-900/40 dark:text-red-300">
                    {t.revokedByAdmin ? "관리자에 의해 폐기됨" : isApp ? "연결 해제됨" : "폐기됨"}
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{workspaceSummary(t.workspaceIds)}</p>
              {t.revokedByAdmin && t.revokeReason && (
                <p className="text-xs text-red-500 dark:text-red-400">폐기 사유: {t.revokeReason}</p>
              )}
              <p className="text-xs text-zinc-400">
                {isApp
                  ? `연결 ${formatDateTime(t.createdAt)} · 마지막 사용 ${formatDateTime(t.lastUsedAt)}`
                  : `생성 ${formatDate(t.createdAt)} · 마지막 사용 ${formatDate(t.lastUsedAt)} · 만료 ${
                      t.expiresAt ? formatDate(t.expiresAt) : "없음"
                    }`}
              </p>
            </div>
            {!t.revokedAt && (
              <button
                type="button"
                onClick={() => onRevoke(t)}
                disabled={busy}
                className="flex min-h-[44px] items-center justify-center gap-1 rounded-md border border-red-200 px-2 text-xs text-red-600 hover:bg-red-50 disabled:opacity-40 md:min-h-0 md:py-1 dark:border-red-900 dark:hover:bg-red-950/40"
                aria-label={isApp ? `${t.name} 연결 해제` : `${t.name} 토큰 폐기`}
              >
                <Ban size={12} aria-hidden />
                {isApp ? "연결 해제" : "폐기"}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
