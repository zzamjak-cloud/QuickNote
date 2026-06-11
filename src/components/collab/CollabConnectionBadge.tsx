// 협업 연결 상태 배지. collabConnectionStore 를 구독한다.
// "idle"(협업 비활성)이면 렌더하지 않는다.
import { useCollabConnectionStore } from "../../store/collabConnectionStore";

const LABEL: Record<"online" | "reconnecting" | "offline", string> = {
  online: "실시간 동기화 중",
  reconnecting: "재연결 중…",
  offline: "오프라인 — 변경사항은 로컬에 저장됨",
};

const DOT: Record<"online" | "reconnecting" | "offline", string> = {
  online: "bg-emerald-500",
  reconnecting: "bg-amber-500 animate-pulse",
  offline: "bg-zinc-400",
};

export function CollabConnectionBadge() {
  const status = useCollabConnectionStore((s) => s.status);
  if (status === "idle") return null;
  return (
    <span
      className="flex items-center gap-1 px-1.5 text-[11px] text-zinc-500 dark:text-zinc-400"
      title={LABEL[status]}
      aria-label={LABEL[status]}
    >
      <span className={`size-2 rounded-full ${DOT[status]}`} />
    </span>
  );
}
