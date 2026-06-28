import { Loader2, Lock } from "lucide-react";
import { useMemo } from "react";
import { useUiStore } from "../../store/uiStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { AppSelect } from "../common/AppSelect";

export function WorkspaceSwitcher() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const setCurrentWorkspaceId = useWorkspaceStore((s) => s.setCurrentWorkspaceId);
  const workspaceLoading = useUiStore((s) => s.workspaceLoading);

  // 보관된 워크스페이스는 선택 목록에서 제외
  const activeWorkspaces = useMemo(
    () =>
      workspaces.filter(
        (w) => !w.removedAt && !/의 개인 노트 \(제거됨\)$/.test(w.name),
      ),
    [workspaces],
  );

  const selected = useMemo(
    () => activeWorkspaces.find((w) => w.workspaceId === currentWorkspaceId) ?? null,
    [activeWorkspaces, currentWorkspaceId],
  );
  const workspaceOptions = useMemo(
    () => activeWorkspaces.map((ws) => ({
      value: ws.workspaceId,
      label: `${ws.name}${ws.myEffectiveLevel === "view" ? " (view)" : ""}`,
    })),
    [activeWorkspaces],
  );

  return (
    <div className="relative flex-1">
      <AppSelect
        ariaLabel="워크스페이스 선택"
        value={currentWorkspaceId ?? ""}
        onChange={(nextValue) => setCurrentWorkspaceId(nextValue || null)}
        options={workspaceOptions}
        placeholder="워크스페이스 없음"
        buttonClassName="w-full rounded-md py-1 text-sm"
        portal
      />
      {selected?.myEffectiveLevel === "view" ? (
        <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400">
          <Lock size={10} />
          view-only
        </span>
      ) : null}
      {workspaceLoading ? (
        <div className="mt-1 flex items-center gap-1 text-[10px] text-zinc-400 dark:text-zinc-500">
          <Loader2 size={10} className="animate-spin" />
          <span>로딩 중</span>
        </div>
      ) : null}
    </div>
  );
}
