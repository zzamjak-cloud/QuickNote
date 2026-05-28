import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Database, Search } from "lucide-react";
import { useDatabaseStore, listDatabases } from "../../../store/databaseStore";
import { koreanIncludes } from "../../../lib/koreanSearch";

type Props = {
  anchorEl: HTMLElement | null;
  currentValue: string | null;
  onSelect: (dbId: string | null) => void;
  onClose: () => void;
};

export function DbLinkSearchPopup({ anchorEl, currentValue, onSelect, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: "hidden" });
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const databases = useDatabaseStore(listDatabases);

  // 앵커 기준 위치 계산
  useLayoutEffect(() => {
    if (!anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const popupWidth = 260;
    const gap = 4;
    const left = Math.min(rect.left, window.innerWidth - popupWidth - 8);
    const top = rect.bottom + gap;
    setStyle({
      position: "fixed",
      top,
      left: Math.max(8, left),
      width: popupWidth,
      zIndex: 9999,
    });
  }, [anchorEl]);

  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

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
  const filtered = q
    ? databases.filter((d) => koreanIncludes(d.meta.title.toLowerCase(), q))
    : databases.slice(0, 20);

  return createPortal(
    <div
      ref={popupRef}
      style={style}
      className="rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
    >
      {/* 검색 입력 */}
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-700">
        <Search size={14} className="shrink-0 text-zinc-400" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="DB 검색..."
          className="flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
        />
      </div>

      {/* DB 목록 */}
      <div className="max-h-60 overflow-y-auto py-1">
        {currentValue && (
          <button
            type="button"
            onClick={() => { onSelect(null); onClose(); }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            — 연결 해제
          </button>
        )}
        {filtered.map((db) => (
          <button
            key={db.id}
            type="button"
            onClick={() => { onSelect(db.id); onClose(); }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-zinc-800 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <Database size={14} className="shrink-0 text-zinc-400" />
            <span className="min-w-0 flex-1 truncate">{db.meta.title || "제목 없음"}</span>
            {db.id === currentValue && <Check size={12} className="shrink-0 text-amber-500" />}
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="px-3 py-4 text-center text-sm text-zinc-400">검색 결과가 없습니다</p>
        )}
      </div>
    </div>,
    document.body,
  );
}
