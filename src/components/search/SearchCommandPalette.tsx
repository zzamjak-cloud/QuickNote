import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Search, X } from "lucide-react";
import { usePageStore } from "../../store/pageStore";
import { useSettingsStore } from "../../store/settingsStore";
import { setPendingNavigation } from "../../lib/editor/pendingNavigation";
import { scrollToSearchHit } from "../../lib/editor/editorNavigationBridge";
import { useSearchController } from "./useSearchController";
import { SearchResultList } from "./SearchResultList";
import { SearchSnippetFeed } from "./SearchSnippetFeed";

type Props = {
  open: boolean;
  onClose: () => void;
};

/** 워크스페이스 전문 검색 — 중앙 2컬럼 커맨드 팔레트(Cmd/Ctrl+K). */
export function SearchCommandPalette({ open, onClose }: Props) {
  const view = useSearchController();
  const inputRef = useRef<HTMLInputElement>(null);
  const setActivePage = usePageStore((s) => s.setActivePage);
  const activePageId = usePageStore((s) => s.activePageId);
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);
  const setCurrentTabDatabase = useSettingsStore((s) => s.setCurrentTabDatabase);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const openPage = (pageId: string) => {
    setCurrentTabPage(pageId);
    setActivePage(pageId);
    onClose();
  };

  const openHit = (pageId: string, blockId: string | null, blockIndex: number) => {
    // 라이브 텍스트 검색으로 중첩(토글/탭/컬럼/표) 안의 정확한 위치까지 짚는다.
    const target = { query: view.query.trim().toLowerCase(), blockId, blockIndex };
    const alreadyActive = pageId === activePageId;
    if (alreadyActive) {
      // 이미 열린 페이지 — Editor 전환 effect 가 안 돌므로 직접 스크롤(약간의 재시도)
      onClose();
      let tries = 0;
      const tick = () => {
        if (scrollToSearchHit(target)) return;
        if (tries++ < 12) window.setTimeout(tick, 100);
      };
      window.setTimeout(tick, 60);
      return;
    }
    // 다른 페이지 — 전환 후 Editor 가 본문 하이드레이션 완료 시 소비
    setPendingNavigation({ pageId, target });
    setCurrentTabPage(pageId);
    setActivePage(pageId);
    onClose();
  };

  const openDatabase = (databaseId: string) => {
    setCurrentTabDatabase(databaseId);
    setActivePage(null);
    onClose();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center bg-black/40 pt-[8vh]"
      onMouseDown={onClose}
    >
      <div
        className="flex h-[560px] max-h-[calc(100vh-120px)] w-[820px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* 검색 입력 */}
        <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
          <Search size={18} className="shrink-0 text-zinc-400" />
          <input
            ref={inputRef}
            data-search-input="true"
            type="text"
            value={view.query}
            onChange={(e) => view.setQuery(e.target.value)}
            placeholder="페이지, 데이터베이스, 본문 내용 검색…"
            className="flex-1 bg-transparent text-base text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
          />
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            aria-label="닫기"
          >
            <X size={16} />
          </button>
        </div>

        {/* 2컬럼 본문 */}
        <div className="flex min-h-0 flex-1">
          <div className="w-[300px] shrink-0 border-r border-zinc-200 dark:border-zinc-700">
            <SearchResultList
              items={view.leftItems}
              total={view.leftTotal}
              dbHits={view.dbHits}
              hasQuery={view.hasQuery}
              onLoadMore={view.loadMoreLeft}
              onOpenPage={openPage}
              onOpenDatabase={openDatabase}
            />
          </div>
          <div className="min-w-0 flex-1">
            <SearchSnippetFeed
              items={view.feedItems}
              total={view.feedTotal}
              indexing={view.indexing}
              hasQuery={view.hasQuery}
              onLoadMore={view.loadMoreFeed}
              onOpenHit={openHit}
            />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
