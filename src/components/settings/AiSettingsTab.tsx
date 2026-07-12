// 설정 > AI 탭 (developer 전용) — API 키 등록/삭제, 활성화 토글, 기본 모델.
// 키 원문은 저장 직후에도 다시 볼 수 없다(마스킹만 표시).
import { useEffect, useState } from "react";
import { KeyRound, Trash2 } from "lucide-react";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useUiStore } from "../../store/uiStore";
import { useAiStore } from "../../store/aiStore";
import {
  clearWorkspaceAiKeyApi,
  getWorkspaceAiConfigApi,
  setWorkspaceAiKeyApi,
  updateWorkspaceAiSettingsApi,
  type WorkspaceAiConfig,
} from "../../lib/sync/aiConfigApi";
import { AI_DEFAULT_MODEL, AI_MODELS } from "../../lib/ai/models";
import { isAiProxyConfigured } from "../../lib/ai/aiClient";
import { SimpleConfirmDialog } from "../ui/SimpleConfirmDialog";

export function AiSettingsTab() {
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const showToast = useUiStore((s) => s.showToast);
  const applyConfig = useAiStore((s) => s.applyConfig);

  const [config, setConfig] = useState<WorkspaceAiConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    setLoading(true);
    getWorkspaceAiConfigApi(workspaceId)
      .then((c) => {
        if (!cancelled) setConfig(c);
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
      () => setWorkspaceAiKeyApi(workspaceId, config?.provider ?? "gemini", key),
      "API 키를 저장했습니다",
    ).then(() => setKeyInput(""));
  };

  if (loading) {
    return <p className="text-sm text-zinc-400">AI 설정을 불러오는 중…</p>;
  }

  return (
    <div className="max-w-xl space-y-8">
      {!isAiProxyConfigured() && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
          AI 서버 주소(VITE_AI_URL)가 이 빌드에 설정되어 있지 않아, 키를 등록해도 AI
          기능이 표시되지 않습니다.
        </p>
      )}

      {/* API 키 */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Gemini API 키</h3>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            키는 서버에 암호화 저장되며 다시 조회할 수 없습니다. 이 워크스페이스의 모든
            멤버가 이 키로 AI 를 사용합니다.
          </p>
        </div>
        {config?.hasKey && (
          <div className="flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700">
            <KeyRound size={14} className="shrink-0 text-emerald-600" aria-hidden />
            <span className="flex-1 font-mono text-zinc-600 dark:text-zinc-300">
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
            placeholder={config?.hasKey ? "새 키 입력 시 교체됩니다" : "AIza…"}
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
          value={config?.defaultModel ?? AI_DEFAULT_MODEL}
          disabled={busy}
          onChange={(e) =>
            void run(
              () => updateWorkspaceAiSettingsApi(workspaceId, { defaultModel: e.target.value }),
              "기본 모델을 변경했습니다",
            )
          }
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          {AI_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
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
