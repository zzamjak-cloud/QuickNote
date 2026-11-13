// 관리 툴 공용 — 토큰 범위 밖 워크스페이스의 항목(알림·즐겨찾기·자산 사용처)을 걸러내는 가시성 판정.
import { canAccessWorkspace } from "../../access";
import type { McpContext } from "../../context";

/**
 * 워크스페이스 가시성 판정기 — 한 호출 안에서 워크스페이스당 한 번만 검사한다.
 * workspaceId 가 없는 항목(워크스페이스에 묶이지 않은 개인 항목)은 보인다.
 */
export function workspaceVisibility(ctx: McpContext): (workspaceId: unknown) => Promise<boolean> {
  const cache = new Map<string, Promise<boolean>>();
  return (workspaceId) => {
    if (typeof workspaceId !== "string" || workspaceId === "") return Promise.resolve(true);
    let pending = cache.get(workspaceId);
    if (!pending) {
      pending = canAccessWorkspace(ctx, workspaceId);
      cache.set(workspaceId, pending);
    }
    return pending;
  };
}

/** 가시성 판정기로 항목을 순서 보존 필터링. */
export async function filterVisible<T>(
  items: T[],
  workspaceOf: (item: T) => unknown,
  visible: (workspaceId: unknown) => Promise<boolean>,
): Promise<T[]> {
  const flags = await Promise.all(items.map((it) => visible(workspaceOf(it))));
  return items.filter((_, i) => flags[i]);
}
