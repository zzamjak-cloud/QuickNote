import { CloudOff } from "lucide-react";
import { useOnlineStatus } from "../../hooks/useOnlineStatus";

// 네트워크 오프라인 시에만 표시되는 앱 전역 배지. 온라인이면 렌더하지 않는다.
// 협업 연결 배지(CollabConnectionBadge)는 협업 활성 시에만 뜨므로 이와 보완 관계.
export function OfflineBadge() {
  const online = useOnlineStatus();
  if (online) return null;
  const label = "오프라인 — 변경사항은 로컬에 저장되며 연결 시 동기화됩니다";
  return (
    <span
      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-amber-600 dark:text-amber-400"
      title={label}
      aria-label={label}
    >
      <CloudOff size={13} className="shrink-0" />
      <span className="hidden sm:inline">오프라인</span>
    </span>
  );
}
