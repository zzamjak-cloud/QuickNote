// 미전송 동기화 때문에 워크스페이스 캐시 전환이 한 단계 지연될 때 안내한다.

import type { ReactElement } from "react";
import { X, CloudOff } from "lucide-react";
import { useUiStore } from "../../store/uiStore";
import { useWorkspaceStore } from "../../store/workspaceStore";

export function WorkspaceSyncBanner(): ReactElement | null {
  const hold = useUiStore((s) => s.outboxWorkspaceSwitchHold);
  const setHold = useUiStore((s) => s.setOutboxWorkspaceSwitchHold);
  const workspaces = useWorkspaceStore((s) => s.workspaces);

  if (!hold) return null;

  const wsName =
    workspaces.find((w) => w.workspaceId === hold.targetWorkspaceId)?.name ??
    "선택한 워크스페이스";

  return (
    <div
      role="status"
      className="flex shrink-0 items-start gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-100"
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
  );
}
