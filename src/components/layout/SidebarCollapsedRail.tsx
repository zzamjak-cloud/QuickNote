// 접힌 사이드바: 좌측 얇은 레일에서 펼치기

import { PanelRightOpen } from "lucide-react";
import { useSettingsStore } from "../../store/settingsStore";

export function SidebarCollapsedRail() {
  const setSidebarCollapsed = useSettingsStore((s) => s.setSidebarCollapsed);

  return (
    <div className="flex h-full w-11 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex justify-center pt-3">
        <button
          type="button"
          onClick={() => setSidebarCollapsed(false)}
          className="rounded-md p-2 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          aria-label="사이드바 펼치기"
          title="사이드바 펼치기 (Ctrl+\\)"
        >
          <PanelRightOpen size={18} />
        </button>
      </div>
    </div>
  );
}
