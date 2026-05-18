// 스케줄러 설정 모달 — 공휴일/MM 대시보드 관리 탭.
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { HolidaysPanel } from "./admin/HolidaysPanel";
import { MmDashboardTab } from "./mm/MmDashboardTab";

type Tab = "holidays" | "mm";

const TABS: { id: Tab; label: string }[] = [
  { id: "mm", label: "MM 대시보드" },
  { id: "holidays", label: "공휴일" },
];

type Props = {
  onClose: () => void;
};

export function SchedulerSettingsModal({ onClose }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("mm");

  // ESC 키로 닫기
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[700] bg-black/40 flex items-center justify-center"
      onClick={onClose}
    >
      {/* 모달 카드 */}
      <div
        className="bg-white dark:bg-zinc-900 rounded-lg shadow-xl w-[1040px] h-[710px] max-w-[94vw] max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex-shrink-0">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            스케줄러 설정
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            aria-label="닫기"
          >
            <X size={18} />
          </button>
        </div>

        {/* 탭 헤더 */}
        <div className="flex border-b border-zinc-200 dark:border-zinc-800 flex-shrink-0 px-6">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-amber-500 text-amber-600 dark:text-amber-400"
                  : "border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 탭 본문 */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === "holidays" && <HolidaysPanel />}
          {activeTab === "mm" && <MmDashboardTab />}
        </div>
      </div>
    </div>,
    document.body,
  );
}
