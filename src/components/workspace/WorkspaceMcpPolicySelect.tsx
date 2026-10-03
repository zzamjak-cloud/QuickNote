// 워크스페이스 MCP 허용 정책 선택 — 바꾸면 즉시 저장한다(서버가 권한 검사: 공유 manager 이상, 개인 소유자).
// MCP 서버는 30초 안에 반영한다.
import { useState } from "react";
import { setWorkspaceMcpPolicyApi } from "../../lib/sync/workspaceApi";
import { useUiStore } from "../../store/uiStore";
import { useWorkspaceStore, type WorkspaceMcpPolicy } from "../../store/workspaceStore";

const OPTIONS: Array<{ value: WorkspaceMcpPolicy; label: string; hint: string }> = [
  { value: "readWrite", label: "읽기+쓰기 허용", hint: "토큰 권한 범위 안에서 AI 가 읽고 편집할 수 있습니다" },
  { value: "read", label: "읽기만 허용", hint: "AI 는 읽기만 할 수 있고 모든 쓰기가 거부됩니다" },
  { value: "disabled", label: "차단", hint: "AI 연결에서 이 워크스페이스가 보이지 않습니다" },
];

type Props = {
  workspaceId: string;
  value: WorkspaceMcpPolicy | null | undefined;
  disabled?: boolean;
};

export function WorkspaceMcpPolicySelect({ workspaceId, value, disabled }: Props) {
  const upsertWorkspace = useWorkspaceStore((s) => s.upsertWorkspace);
  const showToast = useUiStore((s) => s.showToast);
  const [current, setCurrent] = useState<WorkspaceMcpPolicy>(value ?? "readWrite");
  const [saving, setSaving] = useState(false);

  const change = async (next: WorkspaceMcpPolicy) => {
    const prev = current;
    setCurrent(next);
    setSaving(true);
    try {
      upsertWorkspace(await setWorkspaceMcpPolicyApi(workspaceId, next));
      showToast("AI 연결(MCP) 정책을 저장했습니다", { kind: "success" });
    } catch (e) {
      setCurrent(prev);
      showToast(e instanceof Error ? e.message : "MCP 정책 저장에 실패했습니다", { kind: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <label className="block space-y-1">
      <span className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">AI 연결(MCP) 허용</span>
      <select
        aria-label="AI 연결(MCP) 허용 정책"
        value={current}
        disabled={disabled || saving}
        onChange={(e) => void change(e.target.value as WorkspaceMcpPolicy)}
        className="min-h-[44px] w-full rounded border border-zinc-200 bg-white px-2 text-sm outline-none focus:border-zinc-400 disabled:opacity-50 md:min-h-0 md:py-1 dark:border-zinc-700 dark:bg-zinc-900"
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="block text-xs text-zinc-400">{OPTIONS.find((o) => o.value === current)?.hint}</span>
    </label>
  );
}
