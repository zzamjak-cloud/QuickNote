import { Moon, Sun } from "lucide-react";
import { useSettingsStore } from "../../store/settingsStore";
import { usePageStore } from "../../store/pageStore";

export function TopBar() {
  const darkMode = useSettingsStore((s) => s.darkMode);
  const toggleDarkMode = useSettingsStore((s) => s.toggleDarkMode);
  const activeId = usePageStore((s) => s.activePageId);
  const title = usePageStore((s) =>
    activeId ? (s.pages[activeId]?.title ?? "") : "",
  );

  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b border-zinc-200 bg-white px-4 text-sm dark:border-zinc-800 dark:bg-zinc-950">
      <span className="flex-1 truncate text-zinc-500 dark:text-zinc-400">
        {title || "페이지를 선택하거나 새로 만드세요"}
      </span>
      <button
        type="button"
        onClick={toggleDarkMode}
        className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        aria-label="다크 모드 토글"
        title="다크 모드 토글 (Cmd/Ctrl+/)"
      >
        {darkMode ? <Sun size={16} /> : <Moon size={16} />}
      </button>
    </header>
  );
}
