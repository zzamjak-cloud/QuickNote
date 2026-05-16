// 주간 보기 — 이름(구성원) 다중 선택 필터 — TeamScheduler WeekViewMemberFilter 1:1 포팅

import { useState, useRef, useEffect, useMemo } from "react";
import { ChevronDown, UserCircle } from "lucide-react";
import { useSchedulerViewStore } from "../../../store/schedulerViewStore";
import { useVisibleMembers } from "../hooks/useVisibleMembers";

export function WeekViewMemberFilter() {
  const weekViewMemberIds = useSchedulerViewStore((s) => s.weekViewMemberIds);
  const setWeekViewMemberIds = useSchedulerViewStore((s) => s.setWeekViewMemberIds);

  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 조직/팀 필터가 반영된 멤버 목록 사용
  const projectMembers = useVisibleMembers();

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    if (isOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const selectedSet = useMemo(
    () => new Set(weekViewMemberIds ?? []),
    [weekViewMemberIds],
  );

  const toggleMember = (id: string) => {
    const base = weekViewMemberIds ?? projectMembers.map((m) => m.memberId);
    const next = new Set(base);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    const arr = [...next];
    if (arr.length === projectMembers.length) {
      setWeekViewMemberIds(null);
    } else {
      setWeekViewMemberIds(arr);
    }
  };

  const selectAll = () => {
    setWeekViewMemberIds(null);
  };

  const clearAll = () => {
    setWeekViewMemberIds([]);
  };

  const label =
    weekViewMemberIds === null ||
    weekViewMemberIds.length === projectMembers.length
      ? "전체 이름"
      : `${weekViewMemberIds.length}명 선택`;

  if (projectMembers.length === 0) return null;

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="px-3 py-1.5 text-sm border border-zinc-200 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer flex items-center gap-2"
      >
        <UserCircle className="w-4 h-4" />
        <span>{label}</span>
        <ChevronDown
          className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-xl z-50 min-w-[200px] max-h-[320px] overflow-y-auto">
          <div className="border-b border-zinc-200 dark:border-zinc-800 p-1 grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={selectAll}
              className="text-left px-2 py-1.5 text-xs rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
            >
              전체 선택
            </button>
            <button
              type="button"
              onClick={clearAll}
              className="text-left px-2 py-1.5 text-xs rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
            >
              전체 해제
            </button>
          </div>
          <div className="px-3 pt-2 pb-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            구성원 이름
          </div>
          <div className="py-1">
            {projectMembers.map((m) => (
              <label
                key={m.memberId}
                className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={weekViewMemberIds === null ? true : selectedSet.has(m.memberId)}
                  onChange={() => toggleMember(m.memberId)}
                  className="rounded border-zinc-200 dark:border-zinc-700"
                />
                <span className="truncate">{m.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
