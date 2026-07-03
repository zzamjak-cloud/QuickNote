// 직무 필터링 컴포넌트 — 선택된 조직/팀 소속 멤버 기반으로 직무(jobCategory) 목록 한정

import { useState, useRef, useEffect, useMemo } from "react";
import { ChevronDown } from "lucide-react";
import { useSchedulerViewStore } from "../../../store/schedulerViewStore";
import { useVisibleMembers } from "../hooks/useVisibleMembers";

export function JobTitleFilter() {
  // 헤더의 조직/팀 선택에 한정된 멤버 목록 사용 (직무 옵션 산출이므로 직무 필터는 미적용)
  const members = useVisibleMembers({ ignoreJobFilter: true });
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

  // 선택 조직/팀 소속 멤버 직무(jobCategory) 추출 (중복 제거, 정렬)
  const jobCategories = useMemo(() => {
    const categories = [
      ...new Set(
        members
          .map((m) => m.jobCategory)
          .filter(Boolean),
      ),
    ] as string[];
    return categories.sort((a, b) => a.localeCompare(b, "ko"));
  }, [members]);

  // 직무 선택 핸들러
  const handleSelectJobTitle = (category: string | null) => {
    setSelectedJobTitle(category);
    setIsOpen(false);
  };

  // 등록된 직무 구분이 없으면 필터 자체를 표시하지 않는다.
  if (jobCategories.length === 0) return null;

  return (
    <div ref={dropdownRef} className="relative">
      {/* 드롭다운 버튼 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="px-2 py-1 text-xs gap-1 border border-zinc-200 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer flex items-center"
      >
        <span>{selectedJobTitle ?? "직무"}</span>
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

          {/* 직무 리스트 */}
          <div className="py-1 max-h-[300px] overflow-y-auto">
            {jobCategories.map((category) => (
              <button
                key={category}
                onClick={() => handleSelectJobTitle(category)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors ${
                  selectedJobTitle === category
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium"
                    : "text-zinc-900 dark:text-zinc-100"
                }`}
              >
                {category}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
