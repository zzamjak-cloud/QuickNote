// 탭 바 등에서 열리는 우측 패널(즐겨찾기/목차)

import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { X } from "lucide-react";
import { useUiStore } from "../../store/uiStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useIsCompact } from "../../hooks/useViewport";
import { FavoritesList } from "./FavoritesList";
import { PageOutlineList } from "./PageOutlineList";

export function FavoritesPanel() {
  const isCompact = useIsCompact();
  const open = useUiStore((s) => s.rightPanelOpen);
  const tab = useUiStore((s) => s.rightPanelTab);
  const closePanel = useUiStore((s) => s.closeRightPanel);
  const favoriteCount = useSettingsStore((s) => s.favoritePageIds.length);
  const rightPanelWidth = useSettingsStore((s) => s.rightPanelWidth);
  const setRightPanelWidth = useSettingsStore((s) => s.setRightPanelWidth);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  if (!open) return null;

  const isFavorites = tab === "favorites";
  const panelTitle = isFavorites
    ? `즐겨찾기${favoriteCount > 0 ? ` (${favoriteCount})` : ""}`
    : "목차";
  const onResizePointerDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    resizeRef.current = {
      startX: e.clientX,
      startWidth: rightPanelWidth,
    };
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    const onMove = (ev: PointerEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const dx = r.startX - ev.clientX;
      setRightPanelWidth(r.startWidth + dx);
    };
    const onUp = (ev: PointerEvent) => {
      resizeRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      try {
        (ev.target as HTMLElement).releasePointerCapture(ev.pointerId);
      } catch {
        /* noop */
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const panel = (
    <div
      className={
        isCompact
          ? "relative flex h-full w-full flex-col bg-zinc-50 dark:bg-zinc-900"
          : "relative flex h-full shrink-0 flex-col border-l border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
      }
      style={isCompact ? undefined : { width: rightPanelWidth }}
      role="complementary"
      aria-labelledby="qn-right-panel-title"
      onMouseDown={isCompact ? (e) => e.stopPropagation() : undefined}
    >
      {!isCompact && (
        <button
          type="button"
          aria-label="우측 패널 너비 조절"
          title="드래그하여 너비 조절"
          onPointerDown={onResizePointerDown}
          className="absolute left-0 top-0 z-20 h-full w-2 -translate-x-1/2 cursor-col-resize border-0 bg-transparent p-0 hover:bg-blue-500/15 active:bg-blue-500/25"
        />
      )}
      <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
        <h2
          id="qn-right-panel-title"
          className="text-sm font-semibold text-zinc-900 dark:text-zinc-100"
        >
          {panelTitle}
        </h2>
        <button
          type="button"
          onClick={closePanel}
          className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          aria-label="닫기"
        >
          <X size={18} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {isFavorites ? <FavoritesList /> : <PageOutlineList />}
      </div>
    </div>
  );

  // 모바일/컴팩트: 우측 오버레이 드로어(스크림 탭으로 닫힘). 데스크톱: 인라인 컬럼.
  if (isCompact) {
    return (
      <div
        className="fixed inset-0 z-[300] bg-black/40"
        role="presentation"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) closePanel();
        }}
      >
        <div className="absolute inset-y-0 right-0 w-[300px] max-w-[85vw] shadow-xl">
          {panel}
        </div>
      </div>
    );
  }

  return panel;
}
