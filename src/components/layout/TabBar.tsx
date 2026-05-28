import { ChevronLeft, ChevronRight, Database, ListTree, Plus, Star, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useUiStore } from "../../store/uiStore";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../lib/scheduler/scope";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { PageIconDisplay } from "../common/PageIconDisplay";

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
  const tabs = useSettingsStore((s) => s.tabs);
  const activeIdx = useSettingsStore((s) => s.activeTabIndex);
  const setActiveTab = useSettingsStore((s) => s.setActiveTab);
  const closeTab = useSettingsStore((s) => s.closeTab);
  const openTab = useSettingsStore((s) => s.openTab);
  const prevTab = useSettingsStore((s) => s.prevTab);
  const nextTab = useSettingsStore((s) => s.nextTab);
  const pages = usePageStore((s) => s.pages);
  const databases = useDatabaseStore((s) => s.databases);
  const toggleRightPanel = useUiStore((s) => s.toggleRightPanel);
  const rightPanelOpen = useUiStore((s) => s.rightPanelOpen);
  const rightPanelTab = useUiStore((s) => s.rightPanelTab);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const setCurrentWorkspaceId = useWorkspaceStore((s) => s.setCurrentWorkspaceId);
  const tocPanelOpen = rightPanelOpen && rightPanelTab === "toc";
  const favoritesPanelOpen = rightPanelOpen && rightPanelTab === "favorites";

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
                  {database ? (
                    <Database size={14} className="text-zinc-500" />
                  ) : (
                    <PageIconDisplay icon={page?.icon ?? null} size="sm" />
                  )}
                </span>
                <span className="truncate">
                  {page?.title || database?.meta.title || "빈 탭"}
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
