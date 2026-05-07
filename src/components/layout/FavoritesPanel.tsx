// 탭 바 등에서 열리는 우측 즐겨찾기 패널

import { X } from "lucide-react";
import { useUiStore } from "../../store/uiStore";
import { useSettingsStore } from "../../store/settingsStore";
import { FavoritesList } from "./FavoritesList";

export function FavoritesPanel() {
  const open = useUiStore((s) => s.favoritesPanelOpen);
  const closeFavoritesPanel = useUiStore((s) => s.closeFavoritesPanel);
  const favoriteCount = useSettingsStore((s) => s.favoritePageIds.length);

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[360] cursor-default bg-black/20 dark:bg-black/40"
        aria-label="즐겨찾기 패널 닫기"
        onClick={closeFavoritesPanel}
      />
      <aside
        className="fixed right-0 top-0 z-[370] flex h-full w-80 max-w-[90vw] flex-col border-l border-zinc-200 bg-zinc-50 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qn-favorites-panel-title"
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
          <h2
            id="qn-favorites-panel-title"
            className="text-sm font-semibold text-zinc-900 dark:text-zinc-100"
          >
            즐겨찾기{favoriteCount > 0 ? ` (${favoriteCount})` : ""}
          </h2>
          <button
            type="button"
            onClick={closeFavoritesPanel}
            className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label="닫기"
          >
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <FavoritesList />
        </div>
      </aside>
    </>
  );
}
