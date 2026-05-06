import { Lock, ChevronDown } from "lucide-react";
import { useMemo } from "react";
import { useWorkspaceStore } from "../../store/workspaceStore";

export function WorkspaceSwitcher() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const setCurrentWorkspaceId = useWorkspaceStore((s) => s.setCurrentWorkspaceId);

  const selected = useMemo(
    () => workspaces.find((w) => w.workspaceId === currentWorkspaceId) ?? null,
    [workspaces, currentWorkspaceId],
  );

  return (
    <div className="relative flex-1">
      <select
        aria-label="워크스페이스 선택"
        value={currentWorkspaceId ?? ""}
        onChange={(e) => setCurrentWorkspaceId(e.target.value || null)}
        className="w-full appearance-none rounded-md border border-zinc-200 bg-white py-1 pl-2 pr-7 text-xs text-zinc-800 outline-none hover:bg-zinc-50 focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 dark:focus:border-zinc-600"
      >
        {workspaces.length === 0 ? (
          <option value="">워크스페이스 없음</option>
        ) : (
          workspaces.map((ws) => (
            <option key={ws.workspaceId} value={ws.workspaceId}>
              {ws.name}
              {ws.myEffectiveLevel === "view" ? " (view)" : ""}
            </option>
          ))
        )}
      </select>
      <ChevronDown
        size={12}
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400"
      />
      {selected?.myEffectiveLevel === "view" ? (
        <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400">
          <Lock size={10} />
          view-only
        </span>
      ) : null}
    </div>
  );
}
