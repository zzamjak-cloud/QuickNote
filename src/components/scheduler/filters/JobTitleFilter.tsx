// 직군 필터링 컴포넌트 — 선택된 조직/팀 소속 멤버 기반으로 직군 목록 한정

import { useState, useRef, useEffect, useMemo } from "react";
import { ChevronDown, Users } from "lucide-react";
import { useSchedulerViewStore } from "../../../store/schedulerViewStore";
import { useVisibleMembers } from "../hooks/useVisibleMembers";

interface JobTitleFilterProps {
  /** 직군 목록이 없어도 비활성 버튼으로 자리 표시 (주간 보기 등) */
  showWhenEmpty?: boolean;
}

export function JobTitleFilter({ showWhenEmpty = false }: JobTitleFilterProps) {
  // 헤더의 조직/팀 선택에 한정된 멤버 목록 사용
  const members = useVisibleMembers();
  const selectedJobTitle = useSchedulerViewStore((s) => s.selectedJobTitle);
  const setSelectedJobTitle = useSchedulerViewStore((s) => s.setSelectedJobTitle);

  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 외부 클릭 시 닫기
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // 선택 조직/팀 소속 멤버 직군 추출 (jobTitle 우선, 없으면 jobRole, 중복 제거, 정렬)
  const jobTitles = useMemo(() => {
    const titles = [
      ...new Set(
        members
          .map((m) => m.jobTitle ?? m.jobRole)
          .filter(Boolean),
      ),
    ] as string[];
    return titles.sort((a, b) => a.localeCompare(b, "ko"));
  }, [members]);

  // 직군 선택 핸들러
  const handleSelectJobTitle = (jobTitle: string | null) => {
    setSelectedJobTitle(jobTitle);
    setIsOpen(false);
  };

  if (jobTitles.length === 0) {
    if (!showWhenEmpty) return null;
    return (
      <div className="relative">
        <button
          type="button"
          disabled
          className="px-3 py-1.5 text-sm border border-zinc-200 dark:border-zinc-700 rounded-md bg-zinc-100/50 dark:bg-zinc-800/50 text-zinc-500 dark:text-zinc-400 cursor-not-allowed flex items-center gap-2"
          title="등록된 직군 구분이 없습니다"
        >
          <Users className="w-4 h-4" />
          <span>직군 없음</span>
        </button>
      </div>
    );
  }

  return (
    <div ref={dropdownRef} className="relative">
      {/* 드롭다운 버튼 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="px-3 py-1.5 text-sm border border-zinc-200 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer flex items-center gap-2"
      >
        <Users className="w-4 h-4" />
        <span>{selectedJobTitle ?? "전체 직군"}</span>
        <ChevronDown
          className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {/* 드롭다운 메뉴 */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-xl z-50 min-w-[150px]">
          {/* 전체 보기 */}
          <button
            onClick={() => handleSelectJobTitle(null)}
            className={`w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors ${
              selectedJobTitle === null
                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium"
                : "text-zinc-900 dark:text-zinc-100"
            }`}
          >
            전체 보기
          </button>

          <div className="border-t border-zinc-200 dark:border-zinc-800" />

          {/* 직군 리스트 */}
          <div className="py-1 max-h-[300px] overflow-y-auto">
            {jobTitles.map((title) => (
              <button
                key={title}
                onClick={() => handleSelectJobTitle(title)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors ${
                  selectedJobTitle === title
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium"
                    : "text-zinc-900 dark:text-zinc-100"
                }`}
              >
                {title}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
