// 설정 > AI 탭 (developer 전용) — API 키·제공사, 활성화, 기본 모델, 월 한도·사용량.
// 키 원문은 저장 직후에도 다시 볼 수 없다(마스킹만 표시).
import { useEffect, useState } from "react";
import { KeyRound, Trash2 } from "lucide-react";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useUiStore } from "../../store/uiStore";
import { useAiStore } from "../../store/aiStore";
import {
  clearWorkspaceAiKeyApi,
  getWorkspaceAiConfigApi,
  getWorkspaceAiUsageApi,
  setWorkspaceAiKeyApi,
  updateWorkspaceAiSettingsApi,
  type WorkspaceAiConfig,
  type WorkspaceAiUsage,
} from "../../lib/sync/aiConfigApi";
import {
  AI_PROVIDERS,
  defaultModelForProvider,
  isAiProvider,
  modelsForProvider,
  type AiProvider,
} from "../../lib/ai/models";
import { isAiProxyConfigured } from "../../lib/ai/aiClient";
import { SimpleConfirmDialog } from "../ui/SimpleConfirmDialog";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function monthLabel(yyyymm: string): string {
  if (!/^\d{6}$/.test(yyyymm)) return yyyymm;
  return `${yyyymm.slice(0, 4)}-${yyyymm.slice(4)}`;
}

export function AiSettingsTab() {
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const showToast = useUiStore((s) => s.showToast);
  const applyConfig = useAiStore((s) => s.applyConfig);

  const [config, setConfig] = useState<WorkspaceAiConfig | null>(null);
  const [usage, setUsage] = useState<WorkspaceAiUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [keyInput, setKeyInput] = useState("");
  const [providerDraft, setProviderDraft] = useState<AiProvider>("gemini");
  const [quotaDraft, setQuotaDraft] = useState("0");
  const [busy, setBusy] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getWorkspaceAiConfigApi(workspaceId),
      getWorkspaceAiUsageApi(workspaceId).catch(() => null),
    ])
      .then(([c, u]) => {
        if (cancelled) return;
        setConfig(c);
        setProviderDraft(isAiProvider(c.provider) ? c.provider : "gemini");
        setQuotaDraft(String(c.monthlyTokenLimit ?? 0));
        setUsage(u);
      })
      .catch((e) => {
        console.error("[AiSettingsTab] AI 설정 로드 실패", e);
        if (!cancelled) showToast("AI 설정을 불러오지 못했습니다");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, showToast]);

  if (!workspaceId) return null;

  const update = (next: WorkspaceAiConfig) => {
    setConfig(next);
    setProviderDraft(isAiProvider(next.provider) ? next.provider : "gemini");
    setQuotaDraft(String(next.monthlyTokenLimit ?? 0));
    applyConfig(next); // TopBar 등 AI UI 게이팅 즉시 반영
  };

  const run = async (fn: () => Promise<WorkspaceAiConfig>, successMessage: string) => {
    setBusy(true);
    try {
      update(await fn());
      showToast(successMessage);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "요청에 실패했습니다");
    } finally {
      setBusy(false);
    }
  };

  const handleSaveKey = () => {
    const key = keyInput.trim();
    if (!key) return;
    void run(
      () => setWorkspaceAiKeyApi(workspaceId, providerDraft, key),
      "API 키를 저장했습니다",
    ).then(() => setKeyInput(""));
  };

  const handleSaveQuota = () => {
    const n = Number(quotaDraft);
    if (!Number.isInteger(n) || n < 0) {
      showToast("월 토큰 한도는 0 이상의 정수여야 합니다");
      return;
    }
    void run(
      () => updateWorkspaceAiSettingsApi(workspaceId, { monthlyTokenLimit: n }),
      n === 0 ? "월 토큰 한도를 해제했습니다" : "월 토큰 한도를 저장했습니다",
    );
  };

  if (loading) {
    return <p className="text-sm text-zinc-400">AI 설정을 불러오는 중…</p>;
  }

  const provider = (config?.provider && isAiProvider(config.provider)
    ? config.provider
    : "gemini") as AiProvider;
  const models = modelsForProvider(provider);
  const usedTokens = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
  const limit = config?.monthlyTokenLimit ?? 0;

  return (
    <div className="max-w-xl space-y-8">
      {!isAiProxyConfigured() && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
          AI 서버 주소(VITE_AI_URL)가 이 빌드에 설정되어 있지 않아, 키를 등록해도 AI
          기능이 표시되지 않습니다.
        </p>
      )}

      {/* 제공사 · API 키 */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">제공사 · API 키</h3>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            키는 서버에 암호화 저장되며 다시 조회할 수 없습니다. 제공사를 바꾸면 해당
            제공사의 키를 다시 등록해야 합니다.
          </p>
        </div>
        <select
          value={providerDraft}
          disabled={busy}
          onChange={(e) => setProviderDraft(e.target.value as AiProvider)}
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          {AI_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        {config?.hasKey && (
          <div className="flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700">
            <KeyRound size={14} className="shrink-0 text-emerald-600" aria-hidden />
            <span className="flex-1 font-mono text-zinc-600 dark:text-zinc-300">
              {AI_PROVIDERS.find((p) => p.id === provider)?.label ?? provider} ·{" "}
              {config.apiKeyMasked}
            </span>
            <button
              type="button"
              onClick={() => setClearConfirmOpen(true)}
              disabled={busy}
              className="rounded p-1 text-red-500 hover:bg-red-50 disabled:opacity-40 dark:hover:bg-red-950/40"
              aria-label="API 키 삭제"
              title="API 키 삭제"
            >
              <Trash2 size={14} />
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder={
              config?.hasKey
                ? "새 키 입력 시 교체됩니다"
                : providerDraft === "anthropic"
                  ? "sk-ant-…"
                  : "AIza…"
            }
            autoComplete="off"
            className="flex-1 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-violet-400 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="button"
            onClick={handleSaveKey}
            disabled={busy || !keyInput.trim()}
            className="rounded-md bg-violet-600 px-3 py-2 text-sm text-white hover:bg-violet-500 disabled:opacity-40"
          >
            저장
          </button>
        </div>
      </section>

      {/* 활성화 토글 */}
      <section className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">AI 기능 활성화</h3>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            끄면 모든 멤버에게 AI 관련 UI 가 표시되지 않습니다.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={config?.enabled ?? false}
          disabled={busy || (!config?.hasKey && !config?.enabled)}
          onClick={() =>
            void run(
              () =>
                updateWorkspaceAiSettingsApi(workspaceId, { enabled: !(config?.enabled ?? false) }),
              config?.enabled ? "AI 기능을 껐습니다" : "AI 기능을 켰습니다",
            )
          }
          className={[
            "relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-40",
            config?.enabled ? "bg-violet-600" : "bg-zinc-300 dark:bg-zinc-700",
          ].join(" ")}
        >
          <span
            className={[
              "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition",
              config?.enabled ? "left-[1.375rem]" : "left-0.5",
            ].join(" ")}
          />
        </button>
      </section>

      {/* 기본 모델 */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">기본 모델</h3>
        <select
          value={config?.defaultModel ?? defaultModelForProvider(provider)}
          disabled={busy}
          onChange={(e) =>
            void run(
              () => updateWorkspaceAiSettingsApi(workspaceId, { defaultModel: e.target.value }),
              "기본 모델을 변경했습니다",
            )
          }
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </section>

      {/* 월 토큰 한도 */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">월 토큰 한도</h3>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            입력+출력 합산. 0 이면 무제한입니다. 한도 도달 시 AI 요청이 차단됩니다.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            type="number"
            min={0}
            step={1000}
            value={quotaDraft}
            onChange={(e) => setQuotaDraft(e.target.value)}
            disabled={busy}
            className="flex-1 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-violet-400 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="button"
            onClick={handleSaveQuota}
            disabled={busy || quotaDraft === String(limit)}
            className="rounded-md bg-violet-600 px-3 py-2 text-sm text-white hover:bg-violet-500 disabled:opacity-40"
          >
            저장
          </button>
        </div>
      </section>

      {/* 사용량 */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">이번 달 사용량</h3>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {usage ? monthLabel(usage.month) : "—"} · 요청 {usage?.requestCount ?? 0}회
          </p>
        </div>
        <div className="rounded-md border border-zinc-200 px-3 py-3 text-sm dark:border-zinc-700">
          <div className="flex justify-between">
            <span className="text-zinc-500">합계</span>
            <span className="font-mono">
              {formatTokens(usedTokens)}
              {limit > 0 ? ` / ${formatTokens(limit)}` : " (무제한)"}
            </span>
          </div>
          <div className="mt-1 flex justify-between text-xs text-zinc-500">
            <span>입력 {formatTokens(usage?.inputTokens ?? 0)}</span>
            <span>출력 {formatTokens(usage?.outputTokens ?? 0)}</span>
          </div>
          {limit > 0 && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div
                className="h-full rounded-full bg-violet-500 transition-all"
                style={{
                  width: `${Math.min(100, Math.round((usedTokens / limit) * 100))}%`,
                }}
              />
            </div>
          )}
        </div>
        {usage && usage.members.length > 0 && (
          <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200 text-xs dark:divide-zinc-800 dark:border-zinc-700">
            {usage.members.slice(0, 10).map((m) => (
              <li key={m.memberId} className="flex justify-between px-3 py-2 font-mono">
                <span className="truncate text-zinc-500">{m.memberId.slice(0, 8)}…</span>
                <span>
                  {formatTokens(m.inputTokens + m.outputTokens)} · {m.requestCount}회
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <SimpleConfirmDialog
        open={clearConfirmOpen}
        title="API 키 삭제"
        message="키를 삭제하면 이 워크스페이스의 AI 기능이 비활성화됩니다. 계속할까요?"
        confirmLabel="삭제"
        danger
        onCancel={() => setClearConfirmOpen(false)}
        onConfirm={() => {
          setClearConfirmOpen(false);
          void run(() => clearWorkspaceAiKeyApi(workspaceId), "API 키를 삭제했습니다");
        }}
      />
    </div>
  );
}
