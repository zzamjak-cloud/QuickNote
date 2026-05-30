import { ChevronLeft, ChevronRight, Copy, CopyPlus, Database, ListTree, Plus, Star, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useUiStore } from "../../store/uiStore";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../lib/scheduler/scope";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { PageIconDisplay } from "../common/PageIconDisplay";
import { POINTER_PRESS_FEEDBACK_CLASS } from "../common/interactionClasses";
import { buildQuickNotePageUrl } from "../../lib/navigation/quicknoteLinks";

const CLOSE_LC_SCHEDULER_EVENT = "quicknote:close-lc-scheduler";

type LCSchedulerModalModule = typeof import("../scheduler/LCSchedulerModal");

let lcSchedulerModalPromise: Promise<LCSchedulerModalModule> | null = null;

function preloadLCSchedulerModal(): Promise<LCSchedulerModalModule> {
  lcSchedulerModalPromise ??= import("../scheduler/LCSchedulerModal");
  return lcSchedulerModalPromise;
}

const LCSchedulerModal = lazy(() =>
  preloadLCSchedulerModal().then((m) => ({
    default: m.LCSchedulerModal,
  })),
);

function LCSchedulerModalFallback({ onClose }: { onClose: () => void }) {
  return (
    <div
      data-lc-scheduler-modal="true"
      className="fixed inset-0 z-[500] bg-zinc-50 dark:bg-zinc-950 flex flex-col"
    >
      <div className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
            LC 스케줄러
          </h1>
          <span className="text-sm text-zinc-500">일정</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
          aria-label="닫기"
        >
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 bg-zinc-50 dark:bg-zinc-950" />
    </div>
  );
}

export function TabBar() {
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [tabMenu, setTabMenu] = useState<{ index: number; x: number; y: number } | null>(null);
  const tabMenuRef = useRef<HTMLDivElement | null>(null);
  const tabs = useSettingsStore((s) => s.tabs);
  const activeIdx = useSettingsStore((s) => s.activeTabIndex);
  const setActiveTab = useSettingsStore((s) => s.setActiveTab);
  const closeTab = useSettingsStore((s) => s.closeTab);
  const openTab = useSettingsStore((s) => s.openTab);
  const duplicateTab = useSettingsStore((s) => s.duplicateTab);
  const prevTab = useSettingsStore((s) => s.prevTab);
  const nextTab = useSettingsStore((s) => s.nextTab);
  const pages = usePageStore((s) => s.pages);
  const databases = useDatabaseStore((s) => s.databases);
  const showToast = useUiStore((s) => s.showToast);
  const toggleRightPanel = useUiStore((s) => s.toggleRightPanel);
  const rightPanelOpen = useUiStore((s) => s.rightPanelOpen);
  const rightPanelTab = useUiStore((s) => s.rightPanelTab);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const setCurrentWorkspaceId = useWorkspaceStore((s) => s.setCurrentWorkspaceId);
  const tocPanelOpen = rightPanelOpen && rightPanelTab === "toc";
  const favoritesPanelOpen = rightPanelOpen && rightPanelTab === "favorites";

  useEffect(() => {
    if (!tabMenu) return;
    const close = (event: MouseEvent) => {
      if (!tabMenuRef.current?.contains(event.target as Node)) setTabMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTabMenu(null);
    };
    document.addEventListener("mousedown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [tabMenu]);

  const copyTabPageLink = useCallback((index: number) => {
    const tab = useSettingsStore.getState().tabs[index];
    if (!tab?.pageId) {
      showToast("복사할 페이지 링크가 없습니다.", { kind: "error" });
      setTabMenu(null);
      return;
    }
    const writeText = navigator.clipboard?.writeText?.bind(navigator.clipboard);
    if (!writeText) {
      showToast("페이지 링크 복사에 실패했습니다.", { kind: "error" });
      setTabMenu(null);
      return;
    }
    void writeText(buildQuickNotePageUrl({ pageId: tab.pageId }))
      .then(() => showToast("페이지 링크 복사 완료!", { kind: "success" }))
      .catch(() => showToast("페이지 링크 복사에 실패했습니다.", { kind: "error" }));
    setTabMenu(null);
  }, [showToast]);

  const openScheduler = useCallback(() => {
    void preloadLCSchedulerModal();
    setSchedulerOpen(true);
  }, []);

  const closeScheduler = useCallback((options?: { keepSchedulerWorkspace?: boolean }) => {
    const wasSchedulerOpen = schedulerOpen;
    setSchedulerOpen(false);
    if (options?.keepSchedulerWorkspace && wasSchedulerOpen) {
      if (currentWorkspaceId !== LC_SCHEDULER_WORKSPACE_ID) {
        setCurrentWorkspaceId(LC_SCHEDULER_WORKSPACE_ID);
      }
      return;
    }
  }, [currentWorkspaceId, schedulerOpen, setCurrentWorkspaceId]);

  useEffect(() => {
    const handleCloseScheduler = (event: Event) => {
      const detail = (event as CustomEvent<{ keepSchedulerWorkspace?: boolean }>).detail;
      closeScheduler({ keepSchedulerWorkspace: detail?.keepSchedulerWorkspace === true });
    };
    window.addEventListener(CLOSE_LC_SCHEDULER_EVENT, handleCloseScheduler);
    return () => window.removeEventListener(CLOSE_LC_SCHEDULER_EVENT, handleCloseScheduler);
  }, [closeScheduler]);

  useEffect(() => {
    const warmup = () => {
      void preloadLCSchedulerModal();
    };
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(warmup, { timeout: 2500 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(warmup, 1500);
    return () => clearTimeout(id);
  }, []);

  return (
    <div className="relative z-[350] flex h-9 shrink-0 items-center gap-1 border-b border-zinc-200 bg-zinc-50 px-1 dark:border-zinc-800 dark:bg-zinc-900">
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
          const database = tab.databaseId ? databases[tab.databaseId] : null;
          const active = idx === activeIdx;
          const title = page?.title || database?.meta.title || "빈 탭";
          return (
            <div
              key={idx}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setTabMenu({ index: idx, x: event.clientX, y: event.clientY });
              }}
              className={[
                "group relative flex max-w-48 shrink-0 items-center gap-1 rounded-t-md border-t border-l border-r py-1 pl-2 pr-4 text-xs",
                active
                  ? "border-zinc-200 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                  : "border-transparent text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800",
              ].join(" ")}
            >
              <button
                type="button"
                onClick={() => setActiveTab(idx)}
                className={`flex flex-1 items-center gap-1 truncate ${POINTER_PRESS_FEEDBACK_CLASS}`}
              >
                <span className="flex shrink-0 items-center text-sm leading-none">
                  {database ? (
                    <Database size={14} className="text-zinc-500" />
                  ) : (
                    <PageIconDisplay icon={page?.icon ?? null} size="sm" />
                  )}
                </span>
                <span className="truncate">
                  {title}
                </span>
              </button>
              {tabs.length > 1 && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTab(idx);
                    setTabMenu(null);
                  }}
                  className="absolute right-0.5 top-0.5 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-zinc-100 text-zinc-400 opacity-0 transition hover:bg-zinc-200 hover:text-red-500 group-hover:opacity-100 dark:bg-zinc-800 dark:hover:bg-zinc-700"
                  title="탭 닫기"
                  aria-label={`탭 닫기: ${title}`}
                >
                  <X size={10} />
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
      {tabMenu ? createPortal(
        <div
          ref={tabMenuRef}
          role="menu"
          className="fixed z-[900] w-40 rounded-lg border border-zinc-200 bg-white py-1 text-sm shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
          style={{
            left: Math.min(tabMenu.x, window.innerWidth - 168),
            top: Math.min(tabMenu.y, window.innerHeight - 92),
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => copyTabPageLink(tabMenu.index)}
            disabled={!tabs[tabMenu.index]?.pageId}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-45 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <Copy size={14} className="shrink-0" />
            <span>링크복사</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              duplicateTab(tabMenu.index);
              setTabMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <CopyPlus size={14} className="shrink-0" />
            <span>탭복제</span>
          </button>
        </div>,
        document.body,
      ) : null}
      <button
        type="button"
        onClick={openScheduler}
        onMouseEnter={() => {
          void preloadLCSchedulerModal();
        }}
        onFocus={() => {
          void preloadLCSchedulerModal();
        }}
        style={{ backgroundColor: "#edac46" }}
        className="ml-1 inline-flex h-6 shrink-0 items-center rounded px-2 text-xs font-semibold text-white hover:opacity-90"
      >
        LC 스케줄러
      </button>
      <div
        className="ml-1 flex items-center gap-1 rounded-md border border-zinc-200 bg-white p-0.5 dark:border-zinc-700 dark:bg-zinc-900"
        role="radiogroup"
        aria-label="우측 패널 선택"
      >
        <button
          type="button"
          onClick={() => toggleRightPanel("toc")}
          className={[
            "flex h-6 w-6 items-center justify-center rounded text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
            tocPanelOpen ? "bg-zinc-100 text-violet-600 dark:bg-zinc-800 dark:text-violet-300" : "",
          ].join(" ")}
          title="목차 보기"
          aria-label="목차 보기"
          role="radio"
          aria-checked={tocPanelOpen}
        >
          <ListTree size={15} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={() => toggleRightPanel("favorites")}
          className={[
            "flex h-6 w-6 items-center justify-center rounded text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
            favoritesPanelOpen ? "bg-zinc-100 text-amber-500 dark:bg-zinc-800 dark:text-amber-400" : "",
          ].join(" ")}
          title="즐겨찾기"
          aria-label="즐겨찾기"
          role="radio"
          aria-checked={favoritesPanelOpen}
        >
          <Star
            size={15}
            strokeWidth={1.8}
            className={
              favoritesPanelOpen ? "fill-amber-400 text-amber-500" : undefined
            }
          />
        </button>
      </div>
      {schedulerOpen && (
        <Suspense fallback={<LCSchedulerModalFallback onClose={() => closeScheduler()} />}>
          <LCSchedulerModal
            onClose={() => closeScheduler()}
          />
        </Suspense>
      )}
    </div>
  );
}
