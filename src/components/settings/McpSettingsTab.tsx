// 설정 > AI 연결(MCP) 탭 — 외부 AI(Claude·Cursor 등)용 개인 액세스 토큰 발급·조회·폐기.
// 서버는 토큰 해시만 저장하므로 원문은 발급 직후 패널에서 한 번만 보여 준다.
import { useEffect, useState } from "react";
import { Ban } from "lucide-react";
import { useMemberStore } from "../../store/memberStore";
import { useUiStore } from "../../store/uiStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { WorkspaceMcpPolicySelect } from "../workspace/WorkspaceMcpPolicySelect";
import { McpAdminTokensSection } from "./McpAdminTokensSection";
import {
  createMcpTokenApi,
  getMcpServerUrl,
  listMcpTokensApi,
  revokeMcpTokenApi,
  type CreateMcpTokenInput,
  type McpToken,
} from "../../lib/sync/mcpTokenApi";
import { SimpleConfirmDialog } from "../ui/SimpleConfirmDialog";
import { McpTokenCreateForm } from "./McpTokenCreateForm";
import { McpTokenCreatedPanel } from "./McpTokenCreatedPanel";

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString("ko-KR");
}

const SCOPE_LABEL: Record<string, string> = { read: "읽기", write: "쓰기" };

// 토큰 관리 섹션 노출 기준 — 설정 모달의 관리 탭(isAdmin)과 같다. 서버도 manager 이상만 허용한다.
const ADMIN_ROLES = new Set(["developer", "owner", "leader", "manager"]);

export function McpSettingsTab() {
  const showToast = useUiStore((s) => s.showToast);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const role = useMemberStore((s) => s.me?.workspaceRole ?? "member");
  const personalWorkspaceId = useMemberStore((s) => s.me?.personalWorkspaceId ?? null);
  const personalWorkspace = workspaces.find((w) => w.workspaceId === personalWorkspaceId && w.type === "personal");
  const [tokens, setTokens] = useState<McpToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [revokeTarget, setRevokeTarget] = useState<McpToken | null>(null);

  useEffect(() => {
    let cancelled = false;
    listMcpTokensApi()
      .then((list) => {
        if (!cancelled) setTokens(list);
      })
      .catch((e) => {
        console.error("[McpSettingsTab] 토큰 목록 로드 실패", e);
        if (!cancelled) showToast("MCP 토큰 목록을 불러오지 못했습니다", { kind: "error" });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  const workspaceSummary = (ids: string[]): string => {
    if (ids.length === 0) return "전체 워크스페이스";
    const names = ids.map((id) => workspaces.find((w) => w.workspaceId === id)?.name ?? id);
    return names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} 외 ${names.length - 2}개`;
  };

  const handleCreate = async (input: CreateMcpTokenInput) => {
    setBusy(true);
    try {
      const { token, ...meta } = await createMcpTokenApi(input);
      setTokens((prev) => [meta, ...prev]);
      setCreatedToken(token);
      setFormKey((k) => k + 1);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "토큰 발급에 실패했습니다", { kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async () => {
    const target = revokeTarget;
    setRevokeTarget(null);
    if (!target) return;
    setBusy(true);
    try {
      const updated = await revokeMcpTokenApi(target.tokenId);
      setTokens((prev) => prev.map((t) => (t.tokenId === updated.tokenId ? updated : t)));
      showToast(target.kind === "oauth" ? "앱 연결을 해제했습니다" : "토큰을 폐기했습니다");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "토큰 폐기에 실패했습니다", { kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-8">
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">새 토큰 발급</h3>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Claude Code·Cursor 같은 외부 AI 가 MCP 로 내 페이지·데이터베이스를 읽을 수 있게 합니다.
            토큰은 내 권한 범위 안에서만 동작하며, 서버에는 해시만 저장됩니다.
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Claude.ai 는 토큰 없이 연결할 수 있습니다: 설정 &gt; 커넥터 &gt; 사용자 지정 커넥터 추가에 MCP 서버 URL 을
            넣고 로그인·승인하면 아래 목록에 "연결된 앱"으로 표시됩니다.
          </p>
        </div>
        {createdToken ? (
          <McpTokenCreatedPanel
            token={createdToken}
            serverUrl={getMcpServerUrl()}
            onClose={() => setCreatedToken(null)}
          />
        ) : (
          <McpTokenCreateForm key={formKey} busy={busy} onSubmit={(i) => void handleCreate(i)} />
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">발급된 토큰 · 연결된 앱</h3>
        {loading ? (
          <p className="text-sm text-zinc-400">토큰 목록을 불러오는 중…</p>
        ) : tokens.length === 0 ? (
          <p className="text-sm text-zinc-400">발급된 토큰이 없습니다</p>
        ) : (
          <ul className="space-y-2">
            {tokens.map((t) => (
              <li
                key={t.tokenId}
                className={`flex flex-col gap-2 rounded-md border border-zinc-200 p-3 sm:flex-row sm:items-start dark:border-zinc-700 ${
                  t.revokedAt ? "opacity-60" : ""
                }`}
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{t.name}</span>
                    {t.kind === "oauth" ? (
                      <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                        연결된 앱
                      </span>
                    ) : (
                      <span className="font-mono text-xs text-zinc-400">…{t.tokenHint}</span>
                    )}
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
                        {t.revokedByAdmin ? "관리자에 의해 폐기됨" : "폐기됨"}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">{workspaceSummary(t.workspaceIds)}</p>
                  {t.revokedByAdmin && t.revokeReason && (
                    <p className="text-xs text-red-500 dark:text-red-400">폐기 사유: {t.revokeReason}</p>
                  )}
                  <p className="text-xs text-zinc-400">
                    생성 {formatDate(t.createdAt)} · 마지막 사용 {formatDate(t.lastUsedAt)} · 만료{" "}
                    {t.expiresAt ? formatDate(t.expiresAt) : "없음"}
                  </p>
                </div>
                {!t.revokedAt && (
                  <button
                    type="button"
                    onClick={() => setRevokeTarget(t)}
                    disabled={busy}
                    className="flex min-h-[44px] items-center justify-center gap-1 rounded-md border border-red-200 px-2 text-xs text-red-600 hover:bg-red-50 disabled:opacity-40 md:min-h-0 md:py-1 dark:border-red-900 dark:hover:bg-red-950/40"
                    aria-label={t.kind === "oauth" ? `${t.name} 연결 해제` : `${t.name} 토큰 폐기`}
                  >
                    <Ban size={12} aria-hidden />
                    {t.kind === "oauth" ? "연결 해제" : "폐기"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {personalWorkspace && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">내 개인 워크스페이스</h3>
          <WorkspaceMcpPolicySelect workspaceId={personalWorkspace.workspaceId} value={personalWorkspace.mcpPolicy ?? null} />
        </section>
      )}

      {ADMIN_ROLES.has(role) && <McpAdminTokensSection />}

      <SimpleConfirmDialog
        open={revokeTarget != null}
        title="토큰 폐기"
        message={
          revokeTarget
            ? revokeTarget.kind === "oauth"
              ? `"${revokeTarget.name}" 앱의 연결을 해제합니다. 이 앱의 접근이 즉시 끊기며, 다시 쓰려면 앱에서 재연결해야 합니다.`
              : `"${revokeTarget.name}" 토큰을 폐기합니다. 이 토큰을 쓰는 외부 AI 연결이 즉시 끊기며 되돌릴 수 없습니다.`
            : ""
        }
        confirmLabel="폐기"
        danger
        onCancel={() => setRevokeTarget(null)}
        onConfirm={() => void handleRevoke()}
      />
    </div>
  );
}
