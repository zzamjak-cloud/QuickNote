import { ChevronLeft, ChevronRight, Plus, Star, X } from "lucide-react";
import { usePageStore } from "../../store/pageStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useUiStore } from "../../store/uiStore";
import { PageIconDisplay } from "../common/PageIconDisplay";

export function TabBar() {
  const tabs = useSettingsStore((s) => s.tabs);
  const activeIdx = useSettingsStore((s) => s.activeTabIndex);
  const setActiveTab = useSettingsStore((s) => s.setActiveTab);
  const closeTab = useSettingsStore((s) => s.closeTab);
  const openTab = useSettingsStore((s) => s.openTab);
  const prevTab = useSettingsStore((s) => s.prevTab);
  const nextTab = useSettingsStore((s) => s.nextTab);
  const pages = usePageStore((s) => s.pages);
  const toggleFavoritesPanel = useUiStore((s) => s.toggleFavoritesPanel);
  const favoritesPanelOpen = useUiStore((s) => s.favoritesPanelOpen);

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-zinc-200 bg-zinc-50 px-1 dark:border-zinc-800 dark:bg-zinc-900">
      <button
        type="button"
        onClick={prevTab}
        className="rounded p-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        title="이전 탭"
        disabled={activeIdx === 0}
      >
        <ChevronLeft size={14} />
      </button>
      <button
        type="button"
        onClick={nextTab}
        className="rounded p-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        title="다음 탭"
        disabled={activeIdx >= tabs.length - 1}
      >
        <ChevronRight size={14} />
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        {tabs.map((tab, idx) => {
          const page = tab.pageId ? pages[tab.pageId] : null;
          const active = idx === activeIdx;
          return (
            <div
              key={idx}
              className={[
                "group flex max-w-48 shrink-0 items-center gap-1 rounded-t-md border-t border-l border-r px-2 py-1 text-xs",
                active
                  ? "border-zinc-200 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                  : "border-transparent text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800",
              ].join(" ")}
            >
              <button
                type="button"
                onClick={() => setActiveTab(idx)}
                className="flex flex-1 items-center gap-1 truncate"
              >
                <span className="flex shrink-0 items-center text-sm leading-none">
                  <PageIconDisplay icon={page?.icon ?? null} size="sm" />
                </span>
                <span className="truncate">
                  {page?.title || "빈 탭"}
                </span>
              </button>
              {tabs.length > 1 && (
                <button
                  type="button"
                  onClick={() => closeTab(idx)}
                  className="rounded p-0.5 text-zinc-400 opacity-0 transition hover:bg-zinc-200 hover:text-red-500 group-hover:opacity-100 dark:hover:bg-zinc-700"
                  title="탭 닫기"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => openTab(null)}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          title="새 탭"
        >
          <Plus size={14} />
        </button>
      </div>
      <button
        type="button"
        onClick={toggleFavoritesPanel}
        className={[
          "flex h-7 w-7 shrink-0 items-center justify-center rounded text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
          favoritesPanelOpen ? "text-amber-500 dark:text-amber-400" : "",
        ].join(" ")}
        title="즐겨찾기 패널"
        aria-label="즐겨찾기 패널"
        aria-pressed={favoritesPanelOpen}
      >
        <Star
          size={16}
          strokeWidth={1.75}
          className={
            favoritesPanelOpen ? "fill-amber-400 text-amber-500" : undefined
          }
        />
      </button>
    </div>
  );
}
