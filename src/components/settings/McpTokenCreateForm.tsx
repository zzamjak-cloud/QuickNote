// MCP 토큰 발급 폼 — 이름·권한·워크스페이스 범위·만료를 입력받아 onSubmit 으로 넘긴다.
import { useState } from "react";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../lib/scheduler/scope";
import type { CreateMcpTokenInput } from "../../lib/sync/mcpTokenApi";

const EXPIRY_OPTIONS: Array<{ value: string; label: string; days: number | null }> = [
  { value: "30", label: "30일", days: 30 },
  { value: "90", label: "90일", days: 90 },
  { value: "365", label: "365일", days: 365 },
  { value: "never", label: "무기한", days: null },
];

type Props = {
  busy: boolean;
  onSubmit: (input: CreateMcpTokenInput) => void;
};

export function McpTokenCreateForm({ busy, onSubmit }: Props) {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const [name, setName] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expiry, setExpiry] = useState("90");
  const [access, setAccess] = useState<"read" | "write">("read");

  // 스케줄러 가상 워크스페이스·삭제된 워크스페이스·MCP 정책이 차단인 워크스페이스는 MCP 범위 대상이 아니다.
  const selectable = workspaces.filter(
    (w) => w.workspaceId !== LC_SCHEDULER_WORKSPACE_ID && !w.removedAt && w.mcpPolicy !== "disabled",
  );
  const trimmedName = name.trim();

  const toggleWorkspace = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmedName || busy) return;
    onSubmit({
      name: trimmedName,
      scopes: access === "write" ? ["read", "write"] : ["read"],
      workspaceIds: selectedIds,
      expiresInDays: EXPIRY_OPTIONS.find((o) => o.value === expiry)?.days ?? null,
    });
  };

  const inputClass =
    "w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-violet-400 dark:border-zinc-700 dark:bg-zinc-900";

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-md border border-zinc-200 p-3 dark:border-zinc-700"
    >
      <label className="block space-y-1">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">토큰 이름</span>
        <input
          type="text"
          value={name}
          maxLength={64}
          onChange={(e) => setName(e.target.value)}
          placeholder="예: 내 노트북 Claude Code"
          className={inputClass}
        />
      </label>

      <fieldset className="space-y-1">
        <legend className="text-xs font-medium text-zinc-600 dark:text-zinc-300">권한</legend>
        <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
          <label className="flex min-h-[44px] items-center gap-2 text-sm md:min-h-0">
            <input
              type="radio"
              name="mcp-scope"
              checked={access === "read"}
              onChange={() => setAccess("read")}
            />
            읽기
          </label>
          <label className="flex min-h-[44px] items-center gap-2 text-sm md:min-h-0">
            <input
              type="radio"
              name="mcp-scope"
              checked={access === "write"}
              onChange={() => setAccess("write")}
            />
            읽기+쓰기
          </label>
        </div>
        {access === "write" && (
          <p role="note" className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            AI가 편집 권한이 있는 워크스페이스에서 페이지를 만들고, 고치고, 휴지통으로 옮길 수 있습니다.
            영구 삭제는 할 수 없고, 본문 전체를 바꾸기 전에는 버전 히스토리에 저장됩니다.
          </p>
        )}
      </fieldset>

      <fieldset className="space-y-1">
        <legend className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
          워크스페이스 범위{" "}
          <span className="font-normal text-zinc-400">(선택하지 않으면 전체)</span>
        </legend>
        <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-zinc-100 p-2 dark:border-zinc-800">
          {selectable.length === 0 && (
            <p className="text-xs text-zinc-400">접근 가능한 워크스페이스가 없습니다</p>
          )}
          {selectable.map((w) => (
            <label
              key={w.workspaceId}
              className="flex min-h-[44px] items-center gap-2 text-sm md:min-h-0"
            >
              <input
                type="checkbox"
                checked={selectedIds.includes(w.workspaceId)}
                onChange={() => toggleWorkspace(w.workspaceId)}
              />
              <span className="truncate">{w.name}</span>
              {w.mcpPolicy === "read" && (
                <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  읽기 전용
                </span>
              )}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">만료</span>
        <select value={expiry} onChange={(e) => setExpiry(e.target.value)} className={inputClass}>
          {EXPIRY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        disabled={busy || !trimmedName}
        className="w-full rounded-md bg-violet-600 px-3 py-2 text-sm text-white hover:bg-violet-500 disabled:opacity-40 sm:w-auto"
      >
        토큰 발급
      </button>
    </form>
  );
}
