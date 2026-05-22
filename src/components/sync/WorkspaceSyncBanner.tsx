// 미전송 동기화 / 부분 페치 실패 / dead letter 안내 배너.

import { type ReactElement, useEffect, useState } from "react";
import { X, CloudOff, AlertTriangle, Trash2 } from "lucide-react";
import { useUiStore } from "../../store/uiStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { getSyncEngine } from "../../lib/sync/runtime";

const DOMAIN_LABEL: Record<string, string> = {
  pages: "페이지",
  databases: "데이터베이스",
  comments: "댓글",
};

export function WorkspaceSyncBanner(): ReactElement | null {
  const hold = useUiStore((s) => s.outboxWorkspaceSwitchHold);
  const setHold = useUiStore((s) => s.setOutboxWorkspaceSwitchHold);
  const partialFailed = useUiStore((s) => s.syncPartialFetchFailed);
  const clearPartialFailed = useUiStore((s) => s.setSyncPartialFetchFailed);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const [deadLetterCount, setDeadLetterCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void getSyncEngine().then((engine) =>
        engine.getDeadLetterCount().then((n) => {
          if (!cancelled) setDeadLetterCount(n);
        }),
      );
    };
    refresh();
    // 30초마다 재확인 (flush 후 새 dead letter 가 생길 수 있음).
    const id = window.setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (!hold && !partialFailed && deadLetterCount === 0) return null;

  const wsName =
    workspaces.find((w) => w.workspaceId === hold?.targetWorkspaceId)?.name ??
    "선택한 워크스페이스";

  return (
    <div className="flex shrink-0 flex-col divide-y divide-amber-200 dark:divide-amber-900/60">
      {hold && (
        <div
          role="status"
          className="flex items-start gap-2 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:bg-amber-950/50 dark:text-amber-100"
        >
          <CloudOff
            size={16}
            className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-300"
            aria-hidden
          />
          <div className="min-w-0 flex-1 leading-snug">
            <span className="font-semibold">동기화 대기 중</span>
            <p className="mt-0.5 text-amber-900/90 dark:text-amber-50/90">
              미전송 변경 {hold.pending}건 때문에「{wsName}」로 캐시를 바로 비우지
              못했습니다. 전송이 끝나면 자동으로 정리됩니다. 문제가 계속되면
              네트워크 연결을 확인하거나 페이지를 새로고침 하세요.
            </p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded p-1 text-amber-800 hover:bg-amber-200/80 dark:text-amber-200 dark:hover:bg-amber-900/50"
            aria-label="안내 닫기"
            title="닫기"
            onClick={() => setHold(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {partialFailed && (
        <div
          role="alert"
          className="flex items-start gap-2 bg-red-50 px-3 py-2 text-xs text-red-950 dark:bg-red-950/50 dark:text-red-100"
        >
          <AlertTriangle
            size={16}
            className="mt-0.5 shrink-0 text-red-600 dark:text-red-400"
            aria-hidden
          />
          <div className="min-w-0 flex-1 leading-snug">
            <span className="font-semibold">일부 데이터 로드 실패</span>
            <p className="mt-0.5 text-red-900/90 dark:text-red-50/90">
              {partialFailed.map((d) => DOMAIN_LABEL[d] ?? d).join(", ")} 로드에
              실패했습니다. 기존 캐시가 유지됩니다. 네트워크를 확인하거나
              페이지를 새로고침 하세요.
            </p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded p-1 text-red-700 hover:bg-red-200/80 dark:text-red-300 dark:hover:bg-red-900/50"
            aria-label="안내 닫기"
            title="닫기"
            onClick={() => clearPartialFailed(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {deadLetterCount > 0 && (
        <div
          role="status"
          className="flex items-start gap-2 bg-orange-50 px-3 py-2 text-xs text-orange-950 dark:bg-orange-950/50 dark:text-orange-100"
        >
          <AlertTriangle
            size={16}
            className="mt-0.5 shrink-0 text-orange-600 dark:text-orange-400"
            aria-hidden
          />
          <div className="min-w-0 flex-1 leading-snug">
            <span className="font-semibold">
              전송 실패 항목{" "}
              <span className="rounded bg-orange-200/80 px-1 py-0.5 font-mono dark:bg-orange-800/60">
                {deadLetterCount}
              </span>
              건
            </span>
            <p className="mt-0.5 text-orange-900/90 dark:text-orange-50/90">
              영구 실패로 처리된 항목이 있습니다. 제거해도 서버 데이터는 유지됩니다.
            </p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded p-1 text-orange-700 hover:bg-orange-200/80 dark:text-orange-300 dark:hover:bg-orange-900/50"
            aria-label="오류 항목 제거"
            title="오류 항목 제거"
            onClick={() => {
              void getSyncEngine().then((engine) =>
                engine.clearDeadLetters().then(() => setDeadLetterCount(0)),
              );
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
