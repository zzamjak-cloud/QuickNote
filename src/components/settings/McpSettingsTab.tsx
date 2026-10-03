// 설정 > AI 연결(MCP) 탭 — OAuth 빠른 연결(권장)·연결된 앱 목록, 고급 영역의 개인 액세스 토큰(PAT) 발급·폐기.
// 서버는 토큰 해시만 저장하므로 PAT 원문은 발급 직후 패널에서 한 번만 보여 준다.
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemberStore } from "../../store/memberStore";
import { useUiStore } from "../../store/uiStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { WorkspaceMcpPolicySelect } from "../workspace/WorkspaceMcpPolicySelect";
import { McpAdminTokensSection } from "./McpAdminTokensSection";
import {
  createMcpTokenApi,
  getMcpServerUrl,
  isMcpAdminRole,
  listMcpTokensApi,
  revokeMcpTokenApi,
  type CreateMcpTokenInput,
  type McpToken,
} from "../../lib/sync/mcpTokenApi";
import { SimpleConfirmDialog } from "../ui/SimpleConfirmDialog";
import { McpTokenCreateForm } from "./McpTokenCreateForm";
import { McpTokenCreatedPanel } from "./McpTokenCreatedPanel";
import { McpQuickConnectSection } from "./McpQuickConnectSection";
import { McpTokenList } from "./McpTokenList";

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
  const [patOpen, setPatOpen] = useState(false);
  const serverUrl = getMcpServerUrl();
  const apps = tokens.filter((t) => t.kind === "oauth");
  const pats = tokens.filter((t) => t.kind !== "oauth");
  const activePatCount = pats.filter((t) => !t.revokedAt).length;

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

  const listProps = { busy, workspaceSummary, onRevoke: setRevokeTarget };
  const isAppTarget = revokeTarget?.kind === "oauth";

  return (
    <div className="max-w-2xl space-y-8">
      <McpQuickConnectSection serverUrl={serverUrl} />

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">연결된 앱</h3>
        {loading ? (
          <p className="text-sm text-zinc-400">목록을 불러오는 중…</p>
        ) : apps.length === 0 ? (
          <p className="text-sm text-zinc-400">연결된 앱이 없습니다</p>
        ) : (
          <McpTokenList tokens={apps} {...listProps} />
        )}
      </section>

      <section className="space-y-3">
        <button
          type="button"
          onClick={() => setPatOpen((v) => !v)}
          aria-expanded={patOpen}
          aria-controls="mcp-pat-panel"
          className="flex min-h-[44px] w-full items-center gap-1 text-left text-sm font-semibold md:min-h-0"
        >
          {patOpen ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
          고급: 개인 액세스 토큰(PAT)
          {activePatCount > 0 && (
            <span className="ml-1 text-xs font-normal text-zinc-500 dark:text-zinc-400">활성 {activePatCount}개</span>
          )}
        </button>
        <div id="mcp-pat-panel" hidden={!patOpen} className="space-y-6">
          <div className="space-y-3">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              OAuth 를 지원하지 않는 클라이언트(Cursor 등)나 자동화용입니다. 토큰은 내 권한 범위 안에서만 동작하며,
              서버에는 해시만 저장됩니다.
            </p>
            {createdToken ? (
              <McpTokenCreatedPanel token={createdToken} serverUrl={serverUrl} onClose={() => setCreatedToken(null)} />
            ) : (
              <McpTokenCreateForm key={formKey} busy={busy} onSubmit={(i) => void handleCreate(i)} />
            )}
          </div>
          <div className="space-y-3">
            <h4 className="text-sm font-semibold">발급된 토큰</h4>
            {loading ? (
              <p className="text-sm text-zinc-400">토큰 목록을 불러오는 중…</p>
            ) : pats.length === 0 ? (
              <p className="text-sm text-zinc-400">발급된 토큰이 없습니다</p>
            ) : (
              <McpTokenList tokens={pats} {...listProps} />
            )}
          </div>
        </div>
      </section>

      {personalWorkspace && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">내 개인 워크스페이스</h3>
          <WorkspaceMcpPolicySelect workspaceId={personalWorkspace.workspaceId} value={personalWorkspace.mcpPolicy ?? null} />
        </section>
      )}

      {isMcpAdminRole(role) && <McpAdminTokensSection />}

      <SimpleConfirmDialog
        open={revokeTarget != null}
        title={isAppTarget ? "앱 연결 해제" : "토큰 폐기"}
        message={
          revokeTarget
            ? isAppTarget
              ? `"${revokeTarget.name}" 앱의 연결을 해제합니다. 이 앱의 접근이 즉시 끊기며, 다시 쓰려면 앱에서 재연결해야 합니다.`
              : `"${revokeTarget.name}" 토큰을 폐기합니다. 이 토큰을 쓰는 외부 AI 연결이 즉시 끊기며 되돌릴 수 없습니다.`
            : ""
        }
        confirmLabel={isAppTarget ? "연결 해제" : "폐기"}
        danger
        onCancel={() => setRevokeTarget(null)}
        onConfirm={() => void handleRevoke()}
      />
    </div>
  );
}
