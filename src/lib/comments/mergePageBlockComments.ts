import type { BlockCommentMsg, PageBlockCommentsSnapshot } from "../../types/blockComment";

/**
 * 원격 페이지 스냅샷에 `blockComments` 가 비었거나 필드가 없을 때
 * 로컬에만 있던 스레드를 잃지 않도록 id 기준으로 합친다.
 */
export function mergePageBlockComments(
  remote: PageBlockCommentsSnapshot | undefined,
  local: PageBlockCommentsSnapshot | undefined,
): PageBlockCommentsSnapshot | undefined {
  if (!remote && !local) return undefined;
  if (!remote) return local;
  if (!local) return remote;
  const byId = new Map<string, BlockCommentMsg>();
  for (const m of local.messages) {
    byId.set(m.id, m);
  }
  for (const m of remote.messages) {
    byId.set(m.id, m);
  }
  const messages = [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
  // 양쪽 중 더 최근 방문 시각을 유지 (spread 는 remote 가 항상 덮어쓰므로 max 병합)
  const threadVisitedAt: Record<string, number> = { ...local.threadVisitedAt };
  for (const [blockId, t] of Object.entries(remote.threadVisitedAt ?? {})) {
    threadVisitedAt[blockId] = Math.max(threadVisitedAt[blockId] ?? 0, t);
  }
  return { messages, threadVisitedAt };
}
