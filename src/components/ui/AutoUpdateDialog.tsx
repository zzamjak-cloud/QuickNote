import { DialogBase } from "../../lib/ui-primitives";

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
  // 다운로드 진행 중에는 사용자가 실수로 오버레이/ESC 로 닫지 못하게 보호한다.
  const isWorking = state === "downloading";

  return (
    <DialogBase
      open={open}
      onClose={onClose}
      widthClassName="max-w-md"
      labelId="qn-auto-update-title"
      zClassName="z-[510]"
      closeOnOverlay={!isWorking}
      closeOnEsc={!isWorking}
    >
      <DialogBase.Header id="qn-auto-update-title">
        업데이트가 준비되었습니다
      </DialogBase.Header>
      <DialogBase.Body>
        <p>{version ? `새 버전 ${version}` : "새 버전"}을 설치할 수 있습니다.</p>

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
      </DialogBase.Body>
      <DialogBase.Footer>
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
      </DialogBase.Footer>
    </DialogBase>
  );
}
