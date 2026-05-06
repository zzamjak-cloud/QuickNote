// LWW(last-write-wins) 비교 유틸. 단일 사용자 멀티 디바이스 동기화의 충돌 해결에 사용.
// deletedAt 이 설정된 본은 항상 우선(tombstone). 동률이면 로컬 유지.

export type Versioned = {
  updatedAt: string;
  deletedAt?: string | null;
};

export function isRemoteWinner<T extends Versioned>(
  local: T,
  remote: T,
): boolean {
  if (remote.deletedAt && !local.deletedAt) return true;
  if (local.deletedAt && !remote.deletedAt) return false;
  return Date.parse(remote.updatedAt) > Date.parse(local.updatedAt);
}

export function mergeRemote<T extends Versioned>(local: T, remote: T): T {
  return isRemoteWinner(local, remote) ? remote : local;
}
