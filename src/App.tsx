import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Sidebar } from "./components/layout/Sidebar";
import { SidebarCollapsedRail } from "./components/layout/SidebarCollapsedRail";
import { FavoritesPanel } from "./components/layout/FavoritesPanel";
import { TopBar } from "./components/layout/TopBar";
import { TabBar } from "./components/layout/TabBar";
import { Editor } from "./components/editor/Editor";
import { DatabaseRowPage } from "./components/database/DatabaseRowPage";
import { DatabaseRowPeek } from "./components/database/DatabaseRowPeek";
import { TextPromptDialog } from "./components/ui/TextPromptDialog";
import { AutoUpdateDialog } from "./components/ui/AutoUpdateDialog";
import { ToastViewport } from "./components/ui/ToastViewport";
import { WorkspaceSyncBanner } from "./components/sync/WorkspaceSyncBanner";
import { AuthGate } from "./components/auth/AuthGate";
import { useSettingsStore } from "./store/settingsStore";
import { usePageStore } from "./store/pageStore";
import { MigrationScreen } from "./components/MigrationScreen";
import { hasLocalStorageData, migrateFromLocalStorage } from "./lib/migration/fromLocalStorage";
import { zustandStorage } from "./lib/storage/index";
import { useAutoUpdate } from "./hooks/useAutoUpdate";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function App() {
  const darkMode = useSettingsStore((s) => s.darkMode);
  const toggleDarkMode = useSettingsStore((s) => s.toggleDarkMode);
  const activeTabIndex = useSettingsStore((s) => s.activeTabIndex);
  const tabPageId = useSettingsStore(
    (s) => s.tabs[s.activeTabIndex]?.pageId ?? null,
  );
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);
  const openTab = useSettingsStore((s) => s.openTab);
  const prevTab = useSettingsStore((s) => s.prevTab);
  const nextTab = useSettingsStore((s) => s.nextTab);
  const sidebarCollapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const toggleSidebarCollapsed = useSettingsStore((s) => s.toggleSidebarCollapsed);
  const createPage = usePageStore((s) => s.createPage);
  const activePageId = usePageStore((s) => s.activePageId);
  const setActivePage = usePageStore((s) => s.setActivePage);
  const activePage = usePageStore((s) =>
    activePageId ? s.pages[activePageId] : undefined,
  );

  const [migrating, setMigrating] = useState(
    () => isTauri && hasLocalStorageData(),
  );
  const autoUpdate = useAutoUpdate();

  useEffect(() => {
    if (!migrating) return;
    migrateFromLocalStorage(zustandStorage).then(() => setMigrating(false));
  }, [migrating]);

  const hydrationDone = useRef(false);
  /** effect B에서 탭을 active 기준으로 덮어쓸지: activePageId 가 실제로 바뀐 경우만 (탭 클릭 직후 이전 id 로 덮어쓰기 방지) */
  const prevActivePageIdRef = useRef<string | null | undefined>(undefined);

  // 다크 모드 클래스 동기화
  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  // 마운트 시: 탭은 비어 있는데 페이지 스토어에 활성 페이지만 있는 경우(영속 불일치) 탭만 맞춤.
  useLayoutEffect(() => {
    if (hydrationDone.current) return;
    hydrationDone.current = true;
    const tabPageId =
      useSettingsStore.getState().tabs[
        useSettingsStore.getState().activeTabIndex
      ]?.pageId ?? null;
    const pid = usePageStore.getState().activePageId;
    if (tabPageId === null && pid !== null) {
      setCurrentTabPage(pid);
    }
  }, [setCurrentTabPage]);

  // 현재 탭의 pageId가 바뀔 때마다(탭 전환·뒤로가기·replaceCurrentTabPage 등) 활성 페이지와 맞춤.
  // useLayoutEffect: 탭 전환 직후 같은 턴에서 active 를 맞추어, 아래 effect B가 이전 active 로 탭을 덮어쓰지 않게 함.
  useLayoutEffect(() => {
    const cur = usePageStore.getState().activePageId;
    if (tabPageId !== cur) {
      setActivePage(tabPageId);
    }
  }, [tabPageId, activeTabIndex, setActivePage]);

  // 사이드바 등으로 활성 페이지만 바뀐 경우: 현재 탭 내용만 갱신
  useEffect(() => {
    const current =
      useSettingsStore.getState().tabs[
        useSettingsStore.getState().activeTabIndex
      ]?.pageId ?? null;
    if (activePageId === null) {
      prevActivePageIdRef.current = activePageId;
      // 워크스페이스 부트스트랩 시 페이지 맵이 잠깐 비면 activePageId 만 null 이 될 수 있음.
      // 이때 영속화된 탭 pageId 를 null 로 덮어쓰면 재진입 시 항상 빈 탭으로 시작하는 버그가 난다.
      if (current !== null) {
        const pages = usePageStore.getState().pages;
        const hasAnyPage = Object.keys(pages).length > 0;
        if (!hasAnyPage) {
          return;
        }
        if (!pages[current]) {
          setCurrentTabPage(null);
        }
      }
      return;
    }

    const prevActive = prevActivePageIdRef.current;
    const activeIdChanged =
      prevActive !== undefined && prevActive !== activePageId;
    prevActivePageIdRef.current = activePageId;

    if (current !== activePageId) {
      // 탭만 바꾼 프레임에서는 active 가 아직 이전 값 — 이때는 active 로 탭을 덮어쓰면 제목/본문 불일치 발생
      if (!activeIdChanged && prevActive !== undefined) {
        return;
      }
      setCurrentTabPage(activePageId);
    }
  }, [activePageId, activeTabIndex, setCurrentTabPage]);

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
      } else if (e.key === "t") {
        e.preventDefault();
        openTab(null);
      } else if (e.shiftKey && e.key === "[") {
        e.preventDefault();
        prevTab();
      } else if (e.shiftKey && e.key === "]") {
        e.preventDefault();
        nextTab();
      } else if (mod && e.key === "\\") {
        e.preventDefault();
        toggleSidebarCollapsed();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    createPage,
    toggleDarkMode,
    openTab,
    prevTab,
    nextTab,
    toggleSidebarCollapsed,
  ]);

  if (migrating) return <MigrationScreen />;

  return (
    <AuthGate>
      <div className="flex h-screen bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        {sidebarCollapsed ? <SidebarCollapsedRail /> : <Sidebar />}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <TabBar />
          <WorkspaceSyncBanner />
          <TopBar />
          {activePage?.databaseId ? (
            <div className="flex-1 overflow-y-auto">
              <DatabaseRowPage pageId={activePage.id} />
            </div>
          ) : (
            <Editor />
          )}
        </div>
        <FavoritesPanel />
        <DatabaseRowPeek />
        <TextPromptDialog />
        <ToastViewport />
        {autoUpdate.isSupported && (
          <AutoUpdateDialog
            open={autoUpdate.open}
            version={autoUpdate.latestVersion}
            notes={autoUpdate.releaseNotes}
            state={autoUpdate.state}
            progressPercent={autoUpdate.progressPercent}
            errorMessage={autoUpdate.errorMessage}
            onClose={autoUpdate.closeDialog}
            onUpdate={autoUpdate.startUpdate}
            onRestart={autoUpdate.restartNow}
          />
        )}
      </div>
    </AuthGate>
  );
}

export default App;
