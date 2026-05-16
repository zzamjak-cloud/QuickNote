import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Palette, Search, UserCog, ChevronRight } from "lucide-react";
import { COLOR_PRESETS, DEFAULT_SCHEDULE_COLOR } from "../../lib/scheduler/colors";
import type { Member } from "../../store/memberStore";

type Props = {
  x: number;
  y: number;
  currentColor: string;
  onColorChange: (color: string) => void;
  members?: Member[];
  currentMemberId?: string | null;
  onTransfer?: (memberId: string) => void;
  onClose: () => void;
};

export function ContextMenu({
  x,
  y,
  currentColor,
  onColorChange,
  members,
  currentMemberId,
  onTransfer,
  onClose,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [customColor, setCustomColor] = useState(currentColor);
  const [adjustedPos, setAdjustedPos] = useState({ left: x, top: y });
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [showTransferSubmenu, setShowTransferSubmenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  useLayoutEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const margin = 8;
    let left = x;
    let top = y;

    if (top + rect.height > window.innerHeight - margin) {
      top = y - rect.height;
    }
    if (left + rect.width > window.innerWidth - margin) {
      left = window.innerWidth - rect.width - margin;
    }
    setAdjustedPos({
      left: Math.max(margin, left),
      top: Math.max(margin, top),
    });
  }, [x, y]);

  const transferableMembers = (members ?? []).filter(
    (member) => member.memberId !== currentMemberId && member.status === "active",
  );
  const filteredMembers = searchQuery
    ? transferableMembers.filter((member) =>
        member.name.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : transferableMembers;
  const colorOptions = Array.from(new Set([DEFAULT_SCHEDULE_COLOR, ...COLOR_PRESETS]));

  return (
    <div
      ref={menuRef}
      className="fixed bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-xl p-3 z-[720]"
      style={{ left: adjustedPos.left, top: adjustedPos.top }}
    >
      <div className="flex items-center gap-2 mb-2 pb-2 border-b border-zinc-200 dark:border-zinc-700">
        <Palette size={14} className="text-zinc-500" />
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">색상 변경</span>
      </div>

      <div className="grid grid-cols-6 gap-1.5">
        {colorOptions.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => {
              onColorChange(color);
              onClose();
            }}
            className={`w-7 h-7 rounded-md border-2 transition-transform hover:scale-110 ${
              currentColor === color
                ? "border-white ring-2 ring-blue-500"
                : "border-transparent hover:border-zinc-400"
            }`}
            style={{ backgroundColor: color }}
            title={color}
          />
        ))}
      </div>

      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-700">
        <input
          type="color"
          value={customColor}
          onChange={(e) => setCustomColor(e.target.value)}
          className="w-7 h-7 rounded border border-zinc-300 dark:border-zinc-600 bg-transparent cursor-pointer p-0"
        />
        <input
          type="text"
          value={customColor}
          onChange={(e) => setCustomColor(e.target.value)}
          className="flex-1 px-2 py-1 text-xs font-mono border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
        />
        <button
          type="button"
          onClick={() => {
            if (!/^#[0-9A-Fa-f]{6}$/.test(customColor)) return;
            onColorChange(customColor);
            onClose();
          }}
          className="px-2 py-1 text-xs rounded bg-blue-500 hover:bg-blue-600 text-white"
        >
          적용
        </button>
      </div>

      {onTransfer && transferableMembers.length > 0 && (
        <>
          <div className="my-2 border-t border-zinc-200 dark:border-zinc-700" />
          <div
            className="relative"
            onMouseEnter={() => {
              setShowTransferSubmenu(true);
              setTimeout(() => searchInputRef.current?.focus(), 30);
            }}
            onMouseLeave={() => {
              setShowTransferSubmenu(false);
              setSearchQuery("");
            }}
          >
            <button
              type="button"
              className="w-full flex items-center justify-between gap-2 px-2 py-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <div className="flex items-center gap-2">
                <UserCog size={14} className="text-zinc-500" />
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">업무 이관</span>
              </div>
              <ChevronRight size={14} className="text-zinc-500" />
            </button>

            {showTransferSubmenu && (
              <div className="absolute left-full top-0 ml-1 min-w-[180px] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-xl z-[721]">
                <div className="p-2 border-b border-zinc-200 dark:border-zinc-700">
                  <div className="relative">
                    <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500" />
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="이름 검색..."
                      className="w-full pl-7 pr-2 py-1.5 text-sm border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
                    />
                  </div>
                </div>
                <div className="max-h-[200px] overflow-y-auto py-1">
                  {filteredMembers.length > 0 ? (
                    filteredMembers.map((member) => (
                      <button
                        key={member.memberId}
                        type="button"
                        onClick={() => {
                          onTransfer(member.memberId);
                          onClose();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-left"
                      >
                        <span className="text-sm text-zinc-900 dark:text-zinc-100 truncate">
                          {member.name}
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-2 text-sm text-zinc-500 text-center">검색 결과 없음</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
