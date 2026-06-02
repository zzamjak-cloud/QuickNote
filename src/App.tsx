import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Sidebar } from "./components/layout/Sidebar";
import { SidebarCollapsedRail } from "./components/layout/SidebarCollapsedRail";
import { FavoritesPanel } from "./components/layout/FavoritesPanel";
import { TopBar } from "./components/layout/TopBar";
import { TabBar } from "./components/layout/TabBar";
import { Editor } from "./components/editor/Editor";
import { DatabaseDirectPage } from "./components/database/DatabaseDirectPage";
import { ScrollToTopButton } from "./components/common/ScrollToTopButton";
import { TextPromptDialog } from "./components/ui/TextPromptDialog";
import { ToastViewport } from "./components/ui/ToastViewport";
import { WorkspaceSyncBanner } from "./components/sync/WorkspaceSyncBanner";
import { SearchCommandPalette } from "./components/search/SearchCommandPalette";
import { AuthGate } from "./components/auth/AuthGate";
import { useSettingsStore } from "./store/settingsStore";
import { usePageStore, selectFirstSidebarRootId } from "./store/pageStore";
import { useDatabaseStore } from "./store/databaseStore";
import { useUiStore } from "./store/uiStore";
import { MigrationScreen } from "./components/MigrationScreen";
import { hasLocalStorageData, migrateFromLocalStorage } from "./lib/migration/fromLocalStorage";
import { zustandStorage } from "./lib/storage/index";
import { useAutoUpdate } from "./hooks/useAutoUpdate";
import { parseQuickNoteLink, type QuickNoteLinkTarget } from "./lib/navigation/quicknoteLinks";
import { navigateToBlockLink } from "./lib/editor/editorNavigationBridge";
import {
  bindPageScrollMemory,
  flushPageScrollMemory,
  installPageScrollCapture,
  restorePageScrollPosition,
} from "./lib/navigation/pageScrollMemory";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const DatabaseRowPage = lazy(() =>
  import("./components/database/DatabaseRowPage").then((m) => ({
    default: m.DatabaseRowPage,
  })),
);
const DatabaseRowPeek = lazy(() =>
  import("./components/database/DatabaseRowPeek").then((m) => ({
    default: m.DatabaseRowPeek,
  })),
);
const BlockCommentThreadPanel = lazy(() =>
  import("./components/comments/BlockCommentThreadPanel").then((m) => ({
    default: m.BlockCommentThreadPanel,
  })),
);
const AutoUpdateDialog = lazy(() =>
  import("./components/ui/AutoUpdateDialog").then((m) => ({
    default: m.AutoUpdateDialog,
  })),
);

function isLCSchedulerModalOpen(): boolean {
  return Boolean(document.querySelector("[data-lc-scheduler-modal='true']"));
}

function App() {
  const darkMode = useSettingsStore((s) => s.darkMode);
  const toggleDarkMode = useSettingsStore((s) => s.toggleDarkMode);
  const [searchOpen, setSearchOpen] = useState(false);
  const activeTabIndex = useSettingsStore((s) => s.activeTabIndex);
  const activeTab = useSettingsStore(
    (s) => s.tabs[s.activeTabIndex] ?? { pageId: null, databaseId: null },
  );
  const tabDatabaseId = activeTab.databaseId ?? null;
  const tabPageId = tabDatabaseId ? null : activeTab.pageId ?? null;
  const tabRefreshKey = activeTab.refreshKey ?? 0;
  const activeTabContentKey = `${activeTabIndex}:${tabDatabaseId ?? tabPageId ?? "empty"}:${tabRefreshKey}`;
  const tabDatabaseTitle = useDatabaseStore((s) =>
    tabDatabaseId ? (s.databases[tabDatabaseId]?.meta.title ?? null) : null,
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
  const ensureFullPagePageForDatabase = usePageStore(
    (s) => s.ensureFullPagePageForDatabase,
  );
  const tabDatabasePageId = usePageStore((s) =>
    tabDatabaseId ? s.findFullPagePageIdForDatabase(tabDatabaseId) : null,
  );
  const activePage = usePageStore((s) =>
    activePageId ? s.pages[activePageId] : undefined,
  );
  // 사이드바 첫 번째 인덱스(루트) 페이지 — 새로고침 시 기본 선택 대상.
  const firstSidebarPageId = usePageStore(selectFirstSidebarRootId);
  const [migrating, setMigrating] = useState(
    () => isTauri && hasLocalStorageData(),
  );
  const autoUpdate = useAutoUpdate();

  useEffect(() => {
    if (!migrating) return;
    migrateFromLocalStorage(zustandStorage).then(() => setMigrating(false));
  }, [migrating]);

  const hydrationDone = useRef(false);
  /** 새로고침 후 첫 사이드바 페이지 강제 선택을 앱 로드당 1회만 수행 */
  const didForceInitialSelectRef = useRef(false);
  const databaseRowScrollHostRef = useRef<HTMLDivElement | null>(null);
  /** effect B에서 탭을 active 기준으로 덮어쓸지: activePageId 가 실제로 바뀐 경우만 (탭 클릭 직후 이전 id 로 덮어쓰기 방지) */
  const prevActivePageIdRef = useRef<string | null | undefined>(undefined);

  // 다크 모드 클래스 동기화
  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  useEffect(() => {
    const uninstallScrollCapture = installPageScrollCapture();
    document.addEventListener("pointerdown", flushPageScrollMemory, true);
    document.addEventListener("keydown", flushPageScrollMemory, true);
    return () => {
      document.removeEventListener("pointerdown", flushPageScrollMemory, true);
      document.removeEventListener("keydown", flushPageScrollMemory, true);
      uninstallScrollCapture?.();
    };
  }, []);

  useLayoutEffect(() => {
    if (!activePage?.databaseId) return undefined;
    return restorePageScrollPosition(activePageId, databaseRowScrollHostRef.current, "db-row");
  }, [activePage?.databaseId, activePageId]);

  useEffect(() => {
    if (!activePage?.databaseId) return undefined;
    return bindPageScrollMemory(activePageId, databaseRowScrollHostRef.current, "db-row");
  }, [activePage?.databaseId, activePageId]);

  // 멘션 클릭 안전망 — PM 플러그인 체인이 어떤 이유로든 클릭을 처리하지 못하더라도
  // document 레벨에서 mention 클릭을 받아 navigate. (DB 행 페이지 등 특정 컨텍스트에서
  // 클릭이 막혀 보이던 회귀를 영구 차단.) capture 단계로 어떤 자식 핸들러보다 먼저 받는다.
  useEffect(() => {
    const onMentionClick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const el = target.closest<HTMLElement>("[data-type='mention'][data-id]");
      if (!el) return;
      const rawId = el.getAttribute("data-id");
      if (!rawId) return;
      // 멤버 멘션은 페이지 이동이 아니므로 그대로 PM 핸들러에 위임
      if (rawId.startsWith("m:") || el.getAttribute("data-mention-kind") === "member") return;
      const id = rawId.startsWith("p:") ? rawId.slice(2) : rawId;
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      const inPeek = !!el.closest("[data-qn-peek-editor='true']");
      const peekActive = useUiStore.getState().peekPageId;
      if (inPeek && peekActive) {
        useUiStore.getState().peekNavigate(id);
      } else {
        useSettingsStore.getState().setCurrentTabPage(id);
        usePageStore.getState().setActivePage(id);
      }
    };
    document.addEventListener("click", onMentionClick, true);
    return () => document.removeEventListener("click", onMentionClick, true);
  }, []);

  useEffect(() => {
    // 딥링크 대상의 블록/탭으로 이동 — 대상 페이지 에디터가 준비될 때까지 재시도한다.
    const scrollToLinkTarget = (target: QuickNoteLinkTarget) => {
      if (target.blockId != null || target.block != null) {
        navigateToBlockLink(target.pageId, {
          blockId: target.blockId,
          blockPos: target.block,
        });
      }
      if (target.tab) {
        window.setTimeout(() => {
          document
            .querySelector<HTMLButtonElement>(
              `[data-qn-tab-id="${CSS.escape(target.tab!)}"]`,
            )
            ?.click();
        }, 120);
      }
    };

    // 페이지를 연다. 스토어에 아직 없으면 false(콜드 부트 비동기 하이드레이션/원격 페치 대기용).
    const openLinkTarget = (target: QuickNoteLinkTarget): boolean => {
      if (!usePageStore.getState().pages[target.pageId]) return false;
      setActivePage(target.pageId);
      setCurrentTabPage(target.pageId);
      scrollToLinkTarget(target);
      return true;
    };

    const applyLocationLink = () => {
      const target = parseQuickNoteLink(window.location.href);
      if (!target) return;
      openLinkTarget(target);
    };

    // 콜드 부트: 영속 스토어가 비동기로 하이드레이션되고, DB 행 등 일부 페이지는 원격 페치
    // 이후에야 스토어에 들어온다. 마운트 시점에 대상이 없으면 곧장 포기하지 말고, 대상 페이지가
    // 스토어에 들어올 때까지 구독하며 기다렸다가 연다(타임아웃 후 해제).
    let unsubscribe: (() => void) | undefined;
    let waitTimeoutId: number | undefined;
    const initialTarget = parseQuickNoteLink(window.location.href);
    if (initialTarget && !openLinkTarget(initialTarget)) {
      unsubscribe = usePageStore.subscribe((state) => {
        if (!state.pages[initialTarget.pageId]) return;
        unsubscribe?.();
        unsubscribe = undefined;
        if (waitTimeoutId) window.clearTimeout(waitTimeoutId);
        openLinkTarget(initialTarget);
      });
      waitTimeoutId = window.setTimeout(() => {
        unsubscribe?.();
        unsubscribe = undefined;
      }, 20000);
    }

    window.addEventListener("popstate", applyLocationLink);
    window.addEventListener("hashchange", applyLocationLink);
    return () => {
      unsubscribe?.();
      if (waitTimeoutId) window.clearTimeout(waitTimeoutId);
      window.removeEventListener("popstate", applyLocationLink);
      window.removeEventListener("hashchange", applyLocationLink);
    };
  }, [setActivePage, setCurrentTabPage]);

  // 마운트 시: 탭은 비어 있는데 페이지 스토어에 활성 페이지만 있는 경우(영속 불일치) 탭만 맞춤.
  useLayoutEffect(() => {
    if (hydrationDone.current) return;
    hydrationDone.current = true;
    if (useSettingsStore.getState().tabs[useSettingsStore.getState().activeTabIndex]?.databaseId) {
      return;
    }
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
    if (tabDatabaseId) {
      if (usePageStore.getState().activePageId !== null) {
        setActivePage(null);
      }
      return;
    }
    const cur = usePageStore.getState().activePageId;
    if (tabPageId !== cur) {
      setActivePage(tabPageId);
    }
  }, [tabDatabaseId, tabPageId, activeTabIndex, setActivePage]);

  useEffect(() => {
    if (!tabDatabaseId || tabDatabasePageId || tabDatabaseTitle == null) return;
    ensureFullPagePageForDatabase(tabDatabaseId, tabDatabaseTitle);
  }, [
    ensureFullPagePageForDatabase,
    tabDatabaseId,
    tabDatabasePageId,
    tabDatabaseTitle,
  ]);

  // 새로고침 직후: 보던 페이지(영속화된 activePageId)를 유지한다.
  // 페이지 하이드레이션 전이면(firstSidebarPageId 미확정) 대기했다가 확정되는 즉시 앱 로드당 1회만 적용 →
  // "불러오는 중"/빈 탭 노출을 막는다. 단 딥링크로 특정 페이지 진입 시엔 그 페이지를 존중.
  // 영속화된 activePageId 가 스토어에 존재하면 그대로 두고, 없거나(최초 진입) 원격 전용이라
  // 캐시에 아직 없을 때만 사이드바 첫 번째 인덱스(루트) 페이지로 폴백한다.
  // tab-sync 뒤에 두어 같은 커밋에서 마지막에 적용되며, prevActivePageIdRef 도 맞춰
  // 아래 패시브 효과가 이전 값으로 탭을 되돌리지 못하게 한다.
  useLayoutEffect(() => {
    if (didForceInitialSelectRef.current) return;
    if (tabDatabaseId) return;
    if (!firstSidebarPageId) return;
    didForceInitialSelectRef.current = true;
    const linkTarget = parseQuickNoteLink(window.location.href);
    if (linkTarget) {
      // 딥링크 진입 — 대상이 아직 스토어에 없어도(콜드 부트 비동기 하이드레이션/원격 페치)
      // 첫 사이드바 페이지를 강제로 열지 않는다. applyLocationLink 의 구독이 대상이 들어오는
      // 즉시 연다(끝내 안 들어오면 20초 타임아웃). 첫 페이지 강제 시 딥링크가 덮어써지는 것 방지.
      return;
    }
    // 새로고침 시 보던 페이지 유지: 영속화된 activePageId 가 유효하면 폴백하지 않는다.
    const persistedActive = usePageStore.getState().activePageId;
    if (persistedActive && usePageStore.getState().pages[persistedActive]) {
      prevActivePageIdRef.current = persistedActive;
      return;
    }
    prevActivePageIdRef.current = firstSidebarPageId;
    setActivePage(firstSidebarPageId);
  }, [firstSidebarPageId, setActivePage, tabDatabaseId]);

  // 사이드바 등으로 활성 페이지만 바뀐 경우: 현재 탭 내용만 갱신
  useEffect(() => {
    const current =
      useSettingsStore.getState().tabs[
        useSettingsStore.getState().activeTabIndex
      ]?.pageId ?? null;
    const currentDatabaseId =
      useSettingsStore.getState().tabs[
        useSettingsStore.getState().activeTabIndex
      ]?.databaseId ?? null;
    if (currentDatabaseId) {
      prevActivePageIdRef.current = activePageId;
      return;
    }
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
          const fallback = Object.values(pages)
            .sort((a, b) => {
              if (a.parentId == null && b.parentId != null) return -1;
              if (a.parentId != null && b.parentId == null) return 1;
              return a.order - b.order || a.title.localeCompare(b.title);
            })[0]?.id ?? null;
          if (fallback) {
            setCurrentTabPage(fallback);
            setActivePage(fallback);
          } else {
            setCurrentTabPage(null);
          }
        }
      }
      return;
    }

    {
      const pages = usePageStore.getState().pages;
      if (!pages[activePageId] && Object.keys(pages).length > 0) {
        const fallback = Object.values(pages)
          .sort((a, b) => {
            if (a.parentId == null && b.parentId != null) return -1;
            if (a.parentId != null && b.parentId == null) return 1;
            return a.order - b.order || a.title.localeCompare(b.title);
          })[0]?.id ?? null;
        if (fallback) {
          setCurrentTabPage(fallback);
          setActivePage(fallback);
        }
        return;
      }
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
  }, [activePageId, activeTabIndex, setActivePage, setCurrentTabPage]);

  // 글로벌 단축키
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isLCSchedulerModalOpen()) return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "n") {
        e.preventDefault();
        createPage();
      } else if (e.key === "f") {
        // Ctrl/Cmd+F → 검색 팔레트(브라우저 기본 찾기 대체). Ctrl+K 는 링크 단축키로 비워둔다.
        e.preventDefault();
        setSearchOpen(true);
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

  // 사이드바 검색 버튼 등에서 발행하는 검색 팔레트 열기 이벤트 수신
  useEffect(() => {
    const open = () => setSearchOpen(true);
    window.addEventListener("quicknote:open-search", open);
    return () => window.removeEventListener("quicknote:open-search", open);
  }, []);

  if (migrating) return <MigrationScreen />;

  return (
    <AuthGate>
      <div className="flex h-screen bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        {sidebarCollapsed ? <SidebarCollapsedRail /> : <Sidebar />}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <TabBar />
          <WorkspaceSyncBanner />
          <TopBar />
          {tabDatabaseId ? (
            <DatabaseDirectPage
              key={activeTabContentKey}
              databaseId={tabDatabaseId}
              pageId={tabDatabasePageId ?? undefined}
            />
          ) : activePage?.databaseId ? (
            <div
              key={activeTabContentKey}
              ref={databaseRowScrollHostRef}
              data-qn-scroll-page-id={activePageId ?? undefined}
              data-qn-scroll-scope="db-row"
              className="flex-1 overflow-y-auto"
            >
              <Suspense fallback={null}>
                <DatabaseRowPage pageId={activePage.id} />
              </Suspense>
              <ScrollToTopButton scrollRef={databaseRowScrollHostRef} position="fixed" />
            </div>
          ) : (
            <Editor key={activeTabContentKey} />
          )}
        </div>
        <FavoritesPanel />
        <Suspense fallback={null}>
          <DatabaseRowPeek />
          <BlockCommentThreadPanel editor={null} />
        </Suspense>
        <SearchCommandPalette
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
        />
        <TextPromptDialog />
        <ToastViewport />
        {autoUpdate.isSupported && (
          <Suspense fallback={null}>
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
          </Suspense>
        )}
      </div>
    </AuthGate>
  );
}

export default App;
