type Props = {
  open: boolean;
  version: string;
  notes: string;
  state: "idle" | "checking" | "available" | "downloading" | "ready" | "error";
  progressPercent: number;
  errorMessage: string;
  onClose: () => void;
  onUpdate: () => void;
  onRestart: () => void;
};

export function AutoUpdateDialog({
  open,
  version,
  notes,
  state,
  progressPercent,
  errorMessage,
  onClose,
  onUpdate,
  onRestart,
}: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[510] flex items-center justify-center bg-black/45 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && state !== "downloading") onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="qn-auto-update-title"
        className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2
          id="qn-auto-update-title"
          className="text-base font-semibold text-zinc-900 dark:text-zinc-100"
        >
          업데이트가 준비되었습니다
        </h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          {version ? `새 버전 ${version}` : "새 버전"}을 설치할 수 있습니다.
        </p>

        {notes ? (
          <div className="mt-3 max-h-40 overflow-y-auto rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs leading-5 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/40 dark:text-zinc-300">
            {notes}
          </div>
        ) : null}

        {state === "downloading" && (
          <div className="mt-4">
            <div className="mb-1 text-xs text-zinc-500 dark:text-zinc-400">
              다운로드 중... {progressPercent}%
            </div>
            <div className="h-2 rounded bg-zinc-200 dark:bg-zinc-700">
              <div
                className="h-2 rounded bg-blue-500 transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        {state === "error" && (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/40 dark:text-red-300">
            업데이트 실패: {errorMessage || "알 수 없는 오류"}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          {state !== "downloading" && state !== "ready" && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800"
            >
              나중에
            </button>
          )}
          {state === "available" || state === "error" ? (
            <button
              type="button"
              onClick={onUpdate}
              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              지금 업데이트
            </button>
          ) : null}
          {state === "ready" && (
            <button
              type="button"
              onClick={onRestart}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500"
            >
              재시작하고 적용
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
