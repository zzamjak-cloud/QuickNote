import { RefreshCw, X } from "lucide-react";
import { usePwaUpdate } from "../../hooks/usePwaUpdate";

// 새 배포(SW 교체) 감지 시 새로고침을 유도하는 배너. 웹 전용.
export function PwaUpdateBanner() {
  const { isSupported, needRefresh, applyUpdate, dismiss } = usePwaUpdate();

  if (!isSupported || !needRefresh) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[700] flex justify-center px-4"
      role="status"
      aria-live="polite"
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-800 shadow-lg ring-1 ring-black/5 backdrop-blur dark:border-blue-900/60 dark:bg-blue-950/80 dark:text-blue-200 dark:ring-white/10">
        <RefreshCw size={16} className="shrink-0" />
        <span className="min-w-0">새 버전이 있습니다.</span>
        <button
          type="button"
          onClick={() => void applyUpdate()}
          className="shrink-0 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
        >
          새로고침
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 rounded p-0.5 opacity-70 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
          aria-label="알림 닫기"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
