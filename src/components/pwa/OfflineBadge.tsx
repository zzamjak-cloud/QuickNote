import { CloudOff, RefreshCw } from "lucide-react";
import { useOnlineStatus } from "../../hooks/useOnlineStatus";
import { usePendingOutboxCount } from "../../hooks/usePendingOutboxCount";

// 네트워크 오프라인 또는 동기화 대기(outbox 적체) 시 표시되는 앱 전역 배지.
// - 오프라인: 회/호박색 CloudOff. 대기 건수 있으면 함께 표기.
// - 온라인 + 대기 건수>0: 동기화 진행 중(파란색 RefreshCw).
// - 온라인 + 대기 0: 렌더하지 않음.
// 협업 연결 배지(CollabConnectionBadge)는 협업 활성 시에만 뜨므로 보완 관계.
export function OfflineBadge() {
  const online = useOnlineStatus();
  const pending = usePendingOutboxCount();

  if (online && pending === 0) return null;

  if (!online) {
    const label =
      pending > 0
        ? `오프라인 — 변경사항 ${pending}건이 로컬에 저장됨, 연결 시 동기화됩니다`
        : "오프라인 — 변경사항은 로컬에 저장되며 연결 시 동기화됩니다";
    return (
      <span
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-amber-600 dark:text-amber-400"
        title={label}
        aria-label={label}
      >
        <CloudOff size={13} className="shrink-0" />
        <span className="hidden sm:inline">
          오프라인{pending > 0 ? ` · ${pending}` : ""}
        </span>
      </span>
    );
  }

  // online && pending > 0
  const label = `동기화 대기 ${pending}건`;
  return (
    <span
      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-blue-600 dark:text-blue-400"
      title={label}
      aria-label={label}
    >
      <RefreshCw size={13} className="shrink-0 animate-spin" />
      <span className="hidden sm:inline">동기화 {pending}</span>
    </span>
  );
}
