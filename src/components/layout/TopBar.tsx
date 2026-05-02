import { ChevronRight, Moon, Sun, MoreHorizontal } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import type { Page } from "../../types/page";
import { useSettingsStore } from "../../store/settingsStore";
import { usePageStore } from "../../store/pageStore";

export function TopBar() {
  const darkMode = useSettingsStore((s) => s.darkMode);
  const toggleDarkMode = useSettingsStore((s) => s.toggleDarkMode);
  const fullWidth = useSettingsStore((s) => s.fullWidth);
  const toggleFullWidth = useSettingsStore((s) => s.toggleFullWidth);
  const activeId = usePageStore((s) => s.activePageId);
  const pages = usePageStore((s) => s.pages);
  const setActive = usePageStore((s) => s.setActivePage);
  const duplicatePage = usePageStore((s) => s.duplicatePage);
  const deletePage = usePageStore((s) => s.deletePage);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const breadcrumb: { id: string; title: string; icon: string | null }[] = [];
  if (activeId) {
    let cursor: string | null = activeId;
    while (cursor !== null) {
      const page: Page | undefined = pages[cursor];
      if (!page) break;
      breadcrumb.unshift({ id: page.id, title: page.title, icon: page.icon });
      cursor = page.parentId;
    }
  }

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || !activeId) return;
      if (e.key === "l" || e.key === "L") {
        e.preventDefault();
        void navigator.clipboard.writeText(`quicknote://page/${activeId}`);
        setMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId]);

  const handleDuplicate = () => {
    if (!activeId) return;
    const newId = duplicatePage(activeId);
    if (newId) setActive(newId);
    setMenuOpen(false);
  };

  const handleDelete = () => {
    if (!activeId) return;
    deletePage(activeId);
    setMenuOpen(false);
  };

  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b border-zinc-200 bg-white px-4 text-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-1 items-center gap-1 overflow-hidden text-xs text-zinc-500 dark:text-zinc-400">
        {breadcrumb.length === 0 ? (
          <span>페이지를 선택하거나 새로 만드세요</span>
        ) : (
          breadcrumb.map((node, idx) => (
            <div key={node.id} className="flex items-center gap-1">
              {idx > 0 && (
                <ChevronRight size={12} className="text-zinc-300" />
              )}
              <button
                type="button"
                onClick={() => setActive(node.id)}
                className={[
                  "flex items-center gap-1 truncate rounded px-1.5 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800",
                  idx === breadcrumb.length - 1
                    ? "text-zinc-900 dark:text-zinc-100"
                    : "",
                ].join(" ")}
              >
                <span>{node.icon ?? "·"}</span>
                <span className="max-w-32 truncate">
                  {node.title || "제목 없음"}
                </span>
              </button>
            </div>
          ))
        )}
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={toggleDarkMode}
          className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          aria-label="다크 모드 토글"
          title="다크 모드 토글"
        >
          {darkMode ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        {activeId && (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              aria-label="페이지 메뉴"
              title="페이지 메뉴"
            >
              <MoreHorizontal size={16} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 w-52 rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(
                      `quicknote://page/${activeId}`
                    );
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span>링크 복사</span>
                  <span className="text-xs text-zinc-400">⌘L</span>
                </button>
                <button
                  type="button"
                  onClick={handleDuplicate}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span>페이지 복제</span>
                  <span className="text-xs text-zinc-400">⌘D</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    toggleFullWidth();
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span>전체 너비</span>
                  <span className="text-xs text-zinc-400">
                    {fullWidth ? "✓" : ""}
                  </span>
                </button>
                <hr className="my-1 border-zinc-200 dark:border-zinc-700" />
                <button
                  type="button"
                  onClick={handleDelete}
                  className="flex w-full items-center px-3 py-2 text-left text-sm text-red-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  페이지 삭제
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
