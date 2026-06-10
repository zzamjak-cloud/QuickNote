// 현재 페이지 접속자 아바타 스택. collabPresenceStore 를 구독한다(본인 제외).
// 협업 비활성/0명이면 아무것도 렌더하지 않는다.
import { useCollabPresenceStore } from "../../store/collabPresenceStore";

const MAX_VISIBLE = 4;

function initials(name: string): string {
  const t = name.trim();
  return t ? t.slice(0, 1).toUpperCase() : "?";
}

export function CollabPresenceAvatars() {
  const users = useCollabPresenceStore((s) => s.users);
  if (users.length === 0) return null;
  const visible = users.slice(0, MAX_VISIBLE);
  const overflow = users.length - visible.length;
  return (
    <div className="flex items-center -space-x-1.5 pr-1" aria-label="접속자">
      {visible.map((u) => (
        <div
          key={u.clientId}
          title={u.name}
          className="flex size-6 items-center justify-center rounded-full border-2 border-white text-[10px] font-semibold text-white dark:border-zinc-950"
          style={{ backgroundColor: u.color }}
        >
          {u.avatarUrl ? (
            <img src={u.avatarUrl} alt={u.name} className="size-full rounded-full object-cover" />
          ) : (
            initials(u.name)
          )}
        </div>
      ))}
      {overflow > 0 && (
        <div className="flex size-6 items-center justify-center rounded-full border-2 border-white bg-zinc-400 text-[10px] font-semibold text-white dark:border-zinc-950 dark:bg-zinc-600">
          +{overflow}
        </div>
      )}
    </div>
  );
}
