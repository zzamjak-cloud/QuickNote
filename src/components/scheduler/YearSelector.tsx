// 연도 선택 드롭다운 컴포넌트 — TeamScheduler YearSelector 1:1 포팅

import { useState, useRef, useEffect, useMemo } from "react";
import { ChevronDown, CalendarDays, Plus } from "lucide-react";
import { useSchedulerViewStore } from "../../store/schedulerViewStore";

// 기본 연도 범위
const DEFAULT_YEARS = [2024, 2025, 2026, 2027, 2028];

// localStorage에서 연도 목록 로드
const getAvailableYears = (): number[] => {
  if (typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem("quicknote.scheduler.available-years");
      const saved = raw ? (JSON.parse(raw) as number[]) : null;
      if (Array.isArray(saved) && saved.length > 0) {
        return saved.sort((a, b) => a - b);
      }
    } catch {
      // 파싱 실패 시 기본값 사용
    }
  }
  return DEFAULT_YEARS;
};

// localStorage에 연도 목록 저장
const saveAvailableYears = (years: number[]) => {
  if (typeof window !== "undefined") {
    localStorage.setItem(
      "quicknote.scheduler.available-years",
      JSON.stringify(years.sort((a, b) => a - b)),
    );
  }
};

export function YearSelector() {
  const currentYear = useSchedulerViewStore((s) => s.currentYear);
  const setCurrentYear = useSchedulerViewStore((s) => s.setCurrentYear);

  const [isOpen, setIsOpen] = useState(false);
  const [availableYears, setAvailableYears] =
    useState<number[]>(getAvailableYears);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const realCurrentYear = new Date().getFullYear();

  // 다음 추가할 연도 계산
  const nextYear = useMemo(() => {
    return Math.max(...availableYears) + 1;
  }, [availableYears]);

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

  // 연도 선택 핸들러
  const handleSelectYear = (year: number) => {
    setCurrentYear(year);
    setIsOpen(false);
  };

  // 현재(실제 연도)로 돌아가기
  const handleGoToCurrent = () => {
    const first = availableYears[0];
    const last = availableYears[availableYears.length - 1];
    if (availableYears.includes(realCurrentYear)) {
      setCurrentYear(realCurrentYear);
    } else if (first !== undefined && realCurrentYear < first) {
      setCurrentYear(first);
    } else if (last !== undefined) {
      setCurrentYear(last);
    }
    setIsOpen(false);
  };

  // 현재 보고 있는 연도가 실제 현재 연도인지 확인
  const first = availableYears[0];
  const last = availableYears[availableYears.length - 1];
  const isViewingCurrentYear =
    currentYear === realCurrentYear ||
    (!availableYears.includes(realCurrentYear) &&
      ((first !== undefined && realCurrentYear < first && currentYear === first) ||
        (last !== undefined && realCurrentYear > last && currentYear === last)));

  // 연도 추가 핸들러
  const handleAddYear = () => {
    const newYears = [...availableYears, nextYear];
    setAvailableYears(newYears);
    saveAvailableYears(newYears);
  };

  return (
    <div ref={dropdownRef} className="relative">
      {/* 드롭다운 버튼 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="px-3 py-1.5 text-sm font-medium border border-zinc-200 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer flex items-center gap-2"
      >
        <span>{currentYear}년</span>
        <ChevronDown
          className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {/* 드롭다운 메뉴 */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-xl z-50 min-w-[120px]">
          {/* 현재(오늘 연도) 버튼 */}
          <button
            onClick={handleGoToCurrent}
            className={`w-full flex items-center gap-2 px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors font-medium ${
              isViewingCurrentYear
                ? "text-zinc-400 dark:text-zinc-500"
                : "text-amber-500"
            }`}
            disabled={isViewingCurrentYear}
          >
            <CalendarDays className="w-4 h-4" />
            <span className="text-sm">현재</span>
          </button>
          <div className="border-b border-zinc-200 dark:border-zinc-800 mx-2 my-1" />

          {/* 연도 리스트 */}
          <div className="py-1">
            {availableYears.map((year) => (
              <button
                key={year}
                onClick={() => handleSelectYear(year)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors ${
                  currentYear === year
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium"
                    : "text-zinc-900 dark:text-zinc-100"
                }`}
              >
                {year}년
              </button>
            ))}
          </div>

          {/* 연도 추가 버튼 */}
          <div className="border-t border-zinc-200 dark:border-zinc-800 mx-2 my-1" />
          <button
            onClick={handleAddYear}
            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-500 dark:text-zinc-400 hover:text-amber-500"
          >
            <Plus className="w-4 h-4" />
            <span className="text-sm">{nextYear}</span>
          </button>
        </div>
      )}
    </div>
  );
}
