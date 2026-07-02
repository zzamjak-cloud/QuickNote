import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";
import type { Member } from "../../store/memberStore";

type Props = {
  anchorEl: HTMLElement | null;
  allMembers: Member[];
  excludedMemberIds: string[];
  onSelect: (memberId: string) => void;
  onClose: () => void;
};

export function MemberSearchPopup({
  anchorEl,
  allMembers,
  excludedMemberIds,
  onSelect,
  onClose,
}: Props) {
  const [query, setQuery] = useState("");
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: "hidden" });
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const popupWidth = 240;
    const gap = 4;
    let left = rect.left;
    if (left + popupWidth > window.innerWidth - 8) left = window.innerWidth - popupWidth - 8;
    left = Math.max(8, left);
    setStyle({ position: "fixed", top: rect.bottom + gap, left, width: popupWidth, zIndex: 10000 });
  }, [anchorEl]);

  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const available = allMembers
    .filter(
      (m) =>
        !excludedMemberIds.includes(m.memberId) &&
        (!q ||
          (m.name ?? "").toLowerCase().includes(q) ||
          (m.email ?? "").toLowerCase().includes(q)),
    )
    .slice()
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "ko"));

  return createPortal(
    <div
      ref={popupRef}
      style={style}
      className="rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
    >
      <div className="flex items-center gap-1.5 border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-700">
        <Search size={13} className="shrink-0 text-zinc-400" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="이름 또는 이메일 검색"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400 dark:text-zinc-100"
        />
      </div>
      <div className="max-h-52 overflow-y-auto py-1">
        {available.length === 0 ? (
          <p className="px-3 py-2 text-center text-xs text-zinc-400">
            {q ? "검색 결과 없음" : "추가 가능한 구성원 없음"}
          </p>
        ) : (
          available.map((m) => (
            <button
              key={m.memberId}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onSelect(m.memberId); onClose(); }}
              className="flex w-full flex-col px-3 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{m.name}</span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">{m.email}</span>
            </button>
          ))
        )}
      </div>
    </div>,
    document.body,
  );
}
