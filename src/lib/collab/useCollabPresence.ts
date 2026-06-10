// awareness 상태를 구독해 collabPresenceStore 에 원격 접속자 목록을 publish 하는 훅 + 순수 매핑 함수.
import { useEffect } from "react";
import type { Awareness } from "y-protocols/awareness";
import { useCollabPresenceStore, type RemoteUser } from "../../store/collabPresenceStore";

type AwarenessUserState = {
  user?: { memberId?: string; name?: string; color?: string; avatarUrl?: string | null };
};

/**
 * awareness.getStates() → RemoteUser[].
 * 로컬 clientId 제외, user 필드 없는 상태 무시, memberId 기준 dedupe(없으면 clientId 기준).
 */
export function mapAwarenessToUsers(
  states: Map<number, AwarenessUserState>,
  localClientId: number,
): RemoteUser[] {
  const out: RemoteUser[] = [];
  const seen = new Set<string>();
  for (const [clientId, state] of states) {
    if (clientId === localClientId) continue;
    const u = state.user;
    if (!u || !u.name || !u.color) continue;
    const key = u.memberId ?? `client:${clientId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      clientId,
      memberId: u.memberId,
      name: u.name,
      color: u.color,
      avatarUrl: u.avatarUrl ?? null,
    });
  }
  return out;
}

/** awareness 변경을 구독해 presence store 를 갱신한다. awareness 가 null 이면 store 를 비운다. */
export function useCollabPresence(awareness: Awareness | null): void {
  const setUsers = useCollabPresenceStore((s) => s.setUsers);
  const clear = useCollabPresenceStore((s) => s.clear);
  useEffect(() => {
    if (!awareness) {
      clear();
      return undefined;
    }
    const localClientId = awareness.doc?.clientID ?? -1;
    const sync = () => {
      setUsers(mapAwarenessToUsers(awareness.getStates() as Map<number, AwarenessUserState>, localClientId));
    };
    sync();
    awareness.on("change", sync);
    return () => {
      awareness.off("change", sync);
      clear();
    };
  }, [awareness, setUsers, clear]);
}
