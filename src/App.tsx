import { useEffect } from "react";
import { Sidebar } from "./components/layout/Sidebar";
import { TopBar } from "./components/layout/TopBar";
import { Editor } from "./components/editor/Editor";
import { useSettingsStore } from "./store/settingsStore";
import { usePageStore } from "./store/pageStore";

function App() {
  const darkMode = useSettingsStore((s) => s.darkMode);
  const toggleDarkMode = useSettingsStore((s) => s.toggleDarkMode);
  const createPage = usePageStore((s) => s.createPage);

  // 다크 모드 클래스 동기화
  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  // 글로벌 단축키
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "n") {
        e.preventDefault();
        createPage();
      } else if (e.key === "k") {
        e.preventDefault();
        const input =
          document.querySelector<HTMLInputElement>(
            "[data-search-input='true']",
          );
        input?.focus();
      } else if (e.key === "/") {
        e.preventDefault();
        toggleDarkMode();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [createPage, toggleDarkMode]);

  return (
    <div className="flex h-screen bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
        <Editor />
      </div>
    </div>
  );
}

export default App;
