import { PanelLeftClose, Plus, Settings } from "lucide-react";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { NotificationBell } from "../notifications/NotificationBell";

type Props = {
  onCreatePage: () => void;
  onOpenSettings?: () => void;
  onCollapseSidebar?: () => void;
};

export function SidebarHeader({
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
        <span className="min-w-0 flex-1" aria-hidden="true" />
        {/* 좁은 화면에서는 TopBar 알림으로 대체 — 중복 방지 */}
        <span className="hidden lg:inline-flex">
          <NotificationBell />
        </span>
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
