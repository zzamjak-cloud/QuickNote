import { PanelLeftClose, Plus, Settings } from "lucide-react";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

type Props = {
  appVersion: string;
  onCreatePage: () => void;
  onOpenSettings?: () => void;
  onCollapseSidebar?: () => void;
};

export function SidebarHeader({
  appVersion,
  onCreatePage,
  onOpenSettings,
  onCollapseSidebar,
}: Props) {
  return (
    <div className="mb-2 space-y-2 px-1">
      <div className="flex items-center gap-1">
        {onCollapseSidebar ? (
          <button
            type="button"
            onClick={onCollapseSidebar}
            className="shrink-0 rounded-md p-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label="사이드바 접기"
            title="사이드바 접기 (Ctrl+\\)"
          >
            <PanelLeftClose size={16} />
          </button>
        ) : null}
        <h2 className="flex min-w-0 flex-1 items-baseline gap-1 text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          <span>QuickNote</span>
          <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
            v{appVersion}
          </span>
        </h2>
        <button
          type="button"
          onClick={onOpenSettings}
          className="rounded-md p-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          aria-label="설정"
          title="설정"
        >
          <Settings size={15} />
        </button>
        <button
          type="button"
          onClick={onCreatePage}
          className="rounded-md p-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          aria-label="새 페이지"
          title="새 페이지 (Cmd/Ctrl+N)"
        >
          <Plus size={16} />
        </button>
      </div>
      <WorkspaceSwitcher />
    </div>
  );
}
