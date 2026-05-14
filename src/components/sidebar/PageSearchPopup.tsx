import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";
import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore, listDatabases } from "../../store/databaseStore";
import { useSettingsStore } from "../../store/settingsStore";
import { koreanIncludes } from "../../lib/koreanSearch";

type Props = {
  anchorEl: HTMLElement | null;
  onClose: () => void;
};

export function PageSearchPopup({ anchorEl, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: "hidden" });
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const pages = usePageStore((s) => s.pages);
  const databases = useDatabaseStore(listDatabases);
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);

  // 앵커 버튼 기준 위치 계산
  useLayoutEffect(() => {
    if (!anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const popupWidth = 280;
    const gap = 6;

    // 팝업이 뷰포트 오른쪽을 벗어나지 않도록 left 조정
    const left = Math.min(rect.left, window.innerWidth - popupWidth - 8);

    setStyle({
      position: "fixed",
      top: rect.bottom + gap,
      left: Math.max(8, left),
      width: popupWidth,
      zIndex: 9999,
    });
  }, [anchorEl]);

  // 팝업 열릴 때 입력창 포커스
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Escape 키 / 외부 클릭 닫기
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handlePointerDown = (e: PointerEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [onClose]);

  const q = query.trim().toLowerCase();

  const allPages = Object.values(pages);
  const filteredPages = q
    ? allPages.filter((p) => koreanIncludes(p.title.toLowerCase(), q))
    : allPages
        .slice()
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
        .slice(0, 10);

  const filteredDbs = q
    ? databases.filter((d) => koreanIncludes(d.meta.title.toLowerCase(), q))
    : databases.slice(0, 10);

  const handlePageClick = (id: string) => {
    setCurrentTabPage(id);
    onClose();
  };

  return createPortal(
    <div
      ref={popupRef}
      style={style}
      className="rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
    >
      {/* 검색 입력 */}
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-700">
        <Search size={15} className="shrink-0 text-zinc-400" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="페이지 또는 데이터베이스 검색..."
          className="flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
        />
      </div>

      {/* 결과 목록 */}
      <div className="max-h-72 overflow-y-auto py-1">
        {filteredPages.length > 0 && (
          <div>
            <p className="px-3 py-1 text-xs font-semibold text-zinc-400 dark:text-zinc-500">
              페이지
            </p>
            {filteredPages.map((page) => (
              <button
                key={page.id}
                type="button"
                onClick={() => handlePageClick(page.id)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-zinc-800 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                <span className="shrink-0">{page.icon ?? "📄"}</span>
                <span className="truncate">{page.title || "제목 없음"}</span>
              </button>
            ))}
          </div>
        )}

        {filteredDbs.length > 0 && (
          <div>
            <p className="px-3 py-1 text-xs font-semibold text-zinc-400 dark:text-zinc-500">
              데이터베이스
            </p>
            {filteredDbs.map((db) => (
              <button
                key={db.id}
                type="button"
                onClick={() => handlePageClick(db.id)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-zinc-800 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                <span className="shrink-0">🗃️</span>
                <span className="truncate">{db.meta.title || "제목 없음"}</span>
              </button>
            ))}
          </div>
        )}

        {filteredPages.length === 0 && filteredDbs.length === 0 && (
          <p className="px-3 py-4 text-center text-sm text-zinc-400">
            검색 결과가 없습니다
          </p>
        )}
      </div>
    </div>,
    document.body
  );
}
