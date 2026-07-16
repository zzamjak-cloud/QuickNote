import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Sidebar } from "./components/layout/Sidebar";
import { SidebarCollapsedRail } from "./components/layout/SidebarCollapsedRail";
import { FavoritesPanel } from "./components/layout/FavoritesPanel";
import { TopBar } from "./components/layout/TopBar";
import { MobileDrawer } from "./components/ui/MobileDrawer";
import { useIsCompact } from "./hooks/useViewport";
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
import {
  usePageStore,
  selectFirstSidebarRootId,
  isProtectedDatabaseBlockPage,
} from "./store/pageStore";
import { useDatabaseStore } from "./store/databaseStore";
import { useAiStore } from "./store/aiStore";
import { usePageMetaRemoteStore } from "./store/pageMetaRemoteStore";
import { useUiStore } from "./store/uiStore";
import { useWorkspaceStore } from "./store/workspaceStore";
import { MigrationScreen } from "./components/MigrationScreen";
import { hasLocalStorageData, migrateFromLocalStorage } from "./lib/migration/fromLocalStorage";
import { zustandStorage } from "./lib/storage/index";
import { useAutoUpdate } from "./hooks/useAutoUpdate";
import { PwaUpdateBanner } from "./components/ui/PwaUpdateBanner";
import { buildQuickNotePageUrl, parseQuickNoteLink, type QuickNoteLinkTarget } from "./lib/navigation/quicknoteLinks";
import { ensurePageContentLoaded } from "./lib/sync/pageContentLoad";
import { installPageMentionClickNavigation } from "./lib/navigation/pageMentionClick";
import { navigateToBlockLink } from "./lib/editor/editorNavigationBridge";
import { shouldAutoEnsureFullPageDatabaseHome } from "./lib/database/shouldAutoEnsureFullPageDatabaseHome";
import {
  bindPageScrollMemory,
  flushPageScrollMemory,
  installPageScrollCapture,
  restorePageScrollPosition,
} from "./lib/navigation/pageScrollMemory";
import { LC_SCHEDULER_WORKSPACE_ID } from "./lib/scheduler/scope";
import { isProtectedDatabaseId } from "./lib/scheduler/database";

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
const CommentReanchorMode = lazy(() =>
  import("./components/comments/CommentReanchorMode").then((m) => ({
    default: m.CommentReanchorMode,
  })),
);
const AutoUpdateDialog = lazy(() =>
  import("./components/ui/AutoUpdateDialog").then((m) => ({
    default: m.AutoUpdateDialog,
  })),
);
// AI 채팅 패널 — 열 때만 청크 로드
const AiChatPanel = lazy(() =>
  import("./components/ai/AiChatPanel").then((m) => ({
    default: m.AiChatPanel,
  })),
);

function isLCSchedulerModalOpen(): boolean {
  return Boolean(document.querySelector("[data-lc-scheduler-modal='true']"));
}

function App() {
  const darkMode = useSettingsStore((s) => s.darkMode);
  const toggleDarkMode = useSettingsStore((s) => s.toggleDarkMode);
  const aiPanelOpen = useAiStore((s) => s.panelOpen);
  const [searchOpen, setSearchOpen] = useState(false);
  // 컴팩트(<lg) 화면에서 사이드바를 오버레이 드로어로 띄울지.
  const isCompact = useIsCompact();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
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
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const pageMetaNextToken = usePageMetaRemoteStore((s) =>
    currentWorkspaceId
      ? (s.nextTokenByWorkspaceId[currentWorkspaceId] ?? undefined)
      : undefined,
  );
  const pageMetaLoading = usePageMetaRemoteStore((s) =>
    currentWorkspaceId ? s.loadingByWorkspaceId[currentWorkspaceId] === true : false,
  );
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);
  const openTab = useSettingsStore((s) => s.openTab);
  const prevTab = useSettingsStore((s) => s.prevTab);
  const nextTab = useSettingsStore((s) => s.nextTab);
  const sidebarCollapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const toggleSidebarCollapsed = useSettingsStore((s) => s.toggleSidebarCollapsed);
  const workspaceLoading = useUiStore((s) => s.workspaceLoading);
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
  const pendingLocationTargetRef = useRef<QuickNoteLinkTarget | null>(null);

  // 다크 모드 클래스 동기화
  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  // 모바일 드로어: 페이지 이동 시 자동으로 닫고, 데스크톱으로 넓어지면 해제.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [activePageId]);
  useEffect(() => {
    if (!isCompact) setMobileNavOpen(false);
  }, [isCompact]);

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

  // 페이지 멘션 + 블록 링크 버튼 클릭 이동 — 단일 document capture mousedown/mouseup
  // (NodeView 재마운트·모바일/설치 PWA 터치에서 click 보다 안정. 버튼도 멘션과 동일 경로.)
  useEffect(() => installPageMentionClickNavigation(), []);

  // 에디터 내 외부 링크(http/https) 클릭 안전망 — document 캡처 단계에서 받아 새 창으로 연다.
  useEffect(() => {
    const onEditorPointerClick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor?.closest(".ProseMirror")) return;
      if (anchor.closest("[data-bookmark-block], [data-page-link], [data-button-block]")) return;
      const href = anchor.getAttribute("href") ?? "";
      // 같은 페이지 안 블록 점프(노션 자기참조 블록 링크) — blockId(또는 레거시 block 위치)가 있으면
      // 멘션 대신 그 블록으로 이동한다. navigateToBlockLink 가 에디터 준비까지 재시도한다.
      const t = parseQuickNoteLink(href);
      if (t && (t.blockId || t.block != null)) {
        e.preventDefault();
        e.stopPropagation();
        // 링크 표시 텍스트(제목)를 폴백으로 함께 넘긴다 — 협업 시드 본문이 구버전이라
        // blockId(attrs.id)가 어긋나도 제목 텍스트로 이동시켜 무반응을 막는다.
        navigateToBlockLink(t.pageId, {
          blockId: t.blockId,
          blockPos: t.block,
          fallbackText: anchor.textContent,
        });
        return;
      }
      // http(s) 외부 링크만 새 창으로. mailto:/tel: 을 window.open 으로 열면 webview 가
      // 스킴을 처리하지 못해 net::ERR_UNKNOWN_URL_SCHEME → 기본 동작(OS 핸들러)에 위임한다.
      const isWebUrl = /^https?:\/\//i.test(href);
      if (isWebUrl && !parseQuickNoteLink(href)) {
        e.preventDefault();
        e.stopPropagation();
        window.open(href, "_blank", "noopener,noreferrer");
      }
    };
    document.addEventListener("click", onEditorPointerClick, true);
    return () => document.removeEventListener("click", onEditorPointerClick, true);
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

    let unsubscribePendingTarget: (() => void) | undefined;
    let pendingTargetTimeout: number | undefined;

    const clearPendingLocationTarget = (target?: QuickNoteLinkTarget) => {
      if (!target || pendingLocationTargetRef.current?.pageId === target.pageId) {
        pendingLocationTargetRef.current = null;
      }
      unsubscribePendingTarget?.();
      unsubscribePendingTarget = undefined;
      if (pendingTargetTimeout !== undefined) {
        window.clearTimeout(pendingTargetTimeout);
        pendingTargetTimeout = undefined;
      }
    };

    // 페이지를 연다. 스토어에 아직 없으면 false(콜드 부트 비동기 하이드레이션/원격 페치 대기용).
    const openLinkTarget = (target: QuickNoteLinkTarget): boolean => {
      const page = usePageStore.getState().pages[target.pageId];
      if (!page) return false;
      if (
        currentWorkspaceId &&
        page.workspaceId &&
        page.workspaceId !== currentWorkspaceId
      ) {
        return true;
      }
      if (
        currentWorkspaceId !== LC_SCHEDULER_WORKSPACE_ID &&
        isProtectedDatabaseBlockPage(page)
      ) {
        return true;
      }
      setActivePage(target.pageId);
      setCurrentTabPage(target.pageId);
      clearPendingLocationTarget(target);
      scrollToLinkTarget(target);
      return true;
    };

    const openLocationTargetWhenReady = (target: QuickNoteLinkTarget) => {
      pendingLocationTargetRef.current = target;
      if (openLinkTarget(target)) return;
      // 대상이 store 에 없으면(DB 항목 등 지연 로드/콜드 진입) 콘텐츠 로드를 트리거한다.
      // 로드되면 아래 구독이 즉시 연다. (이게 없으면 DB 항목 페이지 딥링크가 20초 타임아웃 후 실패.)
      void ensurePageContentLoaded({
        pageId: target.pageId,
        workspaceId: target.workspaceId ?? currentWorkspaceId,
        source: "deep-link",
      });
      unsubscribePendingTarget?.();
      unsubscribePendingTarget = usePageStore.subscribe((state) => {
        if (state.pages[target.pageId]) openLinkTarget(target);
      });
      if (pendingTargetTimeout !== undefined) window.clearTimeout(pendingTargetTimeout);
      pendingTargetTimeout = window.setTimeout(() => {
        clearPendingLocationTarget(target);
      }, 20_000);
    };

    const initialTarget = parseQuickNoteLink(window.location.href);
    if (initialTarget) {
      openLocationTargetWhenReady(initialTarget);
    } else {
      // URL 에 ?page 가 없으면 현재 활성 페이지를 초기 히스토리 엔트리로 기록한다.
      // 이후 내부 이동마다 pushState 가 쌓이므로 뒤로가기가 시작 페이지까지
      // 앱 내부를 순회하고, 앱 자체를 벗어나지 않는다.
      const activeId = usePageStore.getState().activePageId;
      if (activeId) {
        try {
          window.history.replaceState(
            { qnPage: activeId },
            "",
            buildQuickNotePageUrl({ pageId: activeId }),
          );
        } catch {
          /* noop */
        }
      }
    }

    const applyLocationLink = () => {
      const target = parseQuickNoteLink(window.location.href);
      if (!target) return;
      openLocationTargetWhenReady(target);
    };

    window.addEventListener("popstate", applyLocationLink);
    window.addEventListener("hashchange", applyLocationLink);
    return () => {
      window.removeEventListener("popstate", applyLocationLink);
      window.removeEventListener("hashchange", applyLocationLink);
      clearPendingLocationTarget();
    };
  }, [currentWorkspaceId, setActivePage, setCurrentTabPage]);

  useEffect(() => {
    if (!activePageId) return;
    const target = parseQuickNoteLink(window.location.href);
    if (!target || target.pageId === activePageId) return;
    if (pendingLocationTargetRef.current?.pageId === target.pageId) return;
    try {
      window.history.replaceState(
        { qnPage: activePageId },
        "",
        buildQuickNotePageUrl({ pageId: activePageId }),
      );
    } catch {
      /* noop */
    }
  }, [activePageId]);

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
    if (!shouldAutoEnsureFullPageDatabaseHome({
      currentWorkspaceId,
      pageMetaLoading,
      pageMetaNextToken,
      tabDatabaseId,
      tabDatabasePageId,
      tabDatabaseTitle,
      workspaceBootstrapping: useUiStore.getState().workspaceBootstrapping,
      isProtectedDatabase: !!tabDatabaseId && isProtectedDatabaseId(tabDatabaseId),
    })) return;
    const databaseId = tabDatabaseId;
    const databaseTitle = tabDatabaseTitle;
    if (!databaseId || databaseTitle == null) return;
    // 부트스트랩(원격 페치~landing) 중에는 복원된 DB 탭으로 홈을 자동 생성하지 않는다.
    // 이 구간에 생성하면 유령 풀페이지 DB 홈이 중복 생성된다. landing 이 곧 탭을
    // 첫 인덱스 페이지로 리셋하므로, 사용자가 직접 연 DB 탭(부트 이후)만 홈을 보장한다.
    // 페이지 메타 구조 캐시가 완료되기 전에는 기존 fullPage 홈 메타를 아직 못 본 상태일 수 있다.
    // 이 타이밍의 ensure 는 중복 홈을 만들고, 기존 메타 전용 페이지를 sidebar ghost 로 남긴다.
    ensureFullPagePageForDatabase(databaseId, databaseTitle);
  }, [
    activeTabIndex,
    currentWorkspaceId,
    ensureFullPagePageForDatabase,
    pageMetaLoading,
    pageMetaNextToken,
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
          if (currentWorkspaceId) {
            setActivePage(current);
            return;
          }
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
        if (currentWorkspaceId) return;
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
  }, [activePageId, activeTabIndex, currentWorkspaceId, setActivePage, setCurrentTabPage]);

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
      <div className="flex h-[100dvh] bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        {isCompact ? (
          <MobileDrawer
            open={mobileNavOpen}
            onClose={() => setMobileNavOpen(false)}
          >
            <Sidebar variant="drawer" />
          </MobileDrawer>
        ) : sidebarCollapsed ? (
          <SidebarCollapsedRail />
        ) : (
          <Sidebar />
        )}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <TabBar />
          <WorkspaceSyncBanner />
          <TopBar onOpenNav={isCompact ? () => setMobileNavOpen(true) : undefined} />
          {workspaceLoading ? (
            <div
              role="status"
              className="flex shrink-0 items-center gap-2 border-b border-yellow-300 bg-yellow-100 px-4 py-2 text-xs font-medium text-yellow-950 shadow-sm dark:border-yellow-500/60 dark:bg-yellow-400/20 dark:text-yellow-100"
            >
              <Loader2 size={14} className="animate-spin text-yellow-700 dark:text-yellow-200" />
              <span>
                {workspaceLoading.workspaceName
                  ? `${workspaceLoading.workspaceName} 불러오는 중…`
                  : "워크스페이스 불러오는 중…"}
              </span>
            </div>
          ) : null}
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
          <CommentReanchorMode />
          {aiPanelOpen && <AiChatPanel />}
        </Suspense>
        <SearchCommandPalette
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
        />
        <TextPromptDialog />
        <ToastViewport />
        <PwaUpdateBanner />
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
