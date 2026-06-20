import type { DownloadNotice } from "./BlockHandlesTypes";

// 첨부 다운로드 진행/성공/실패 토스트 — 우하단 고정. notice 없으면 렌더 안 함.
export function DownloadNoticeToast({ notice }: { notice: DownloadNotice }) {
  if (!notice) return null;
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[420]">
      <div
        className={`rounded-lg border px-3 py-2 text-xs shadow-lg ${
          notice.kind === "error"
            ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300"
            : notice.kind === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300"
              : "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/50 dark:text-blue-300"
        }`}
      >
        {notice.message}
      </div>
    </div>
  );
}
