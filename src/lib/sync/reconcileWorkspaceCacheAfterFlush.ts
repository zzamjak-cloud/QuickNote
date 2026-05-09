import { usePageStore } from "../../store/pageStore";
import { useUiStore } from "../../store/uiStore";
import { applyWorkspaceLanding } from "./workspaceLanding";
import { applyWorkspaceSwitch } from "./workspaceSwitch";

/**
 * outbox flush 후 캐시 전환을 재시도하거나, UI 워크스페이스와 로컬 캐시 소속이 어긋난 상태를 바로잡는다.
 * Bootstrap 및 online 복귀에서 동일 패턴으로 사용한다.
 */
export async function reconcileWorkspaceCacheAfterFlush(options: {
  currentWorkspaceId: string;
  /** Bootstrap 가드 시작 시 세션 차원의 전환 전 워크스페이스(선택; 온라인 복귀 등에서는 생략 가능) */
  sessionPrevWorkspaceId?: string | null;
  fetchApply: () => Promise<void>;
  cancelled?: () => boolean;
}): Promise<void> {
  const { currentWorkspaceId, sessionPrevWorkspaceId, fetchApply, cancelled } =
    options;
  const hold = useUiStore.getState().outboxWorkspaceSwitchHold;
  const pageCacheWs = usePageStore.getState().cacheWorkspaceId;

  const cacheMismatch =
    pageCacheWs != null && pageCacheWs !== currentWorkspaceId;
  if (hold == null && !cacheMismatch) return;

  const prevHint =
    hold?.sourceWorkspaceId ??
    sessionPrevWorkspaceId ??
    (cacheMismatch ? pageCacheWs : null);

  const retry = await applyWorkspaceSwitch(prevHint, currentWorkspaceId);
  if (cancelled?.()) return;

  const setHold = useUiStore.getState().setOutboxWorkspaceSwitchHold;

  if (retry.reason === "pending-outbox") {
    const pageCw = usePageStore.getState().cacheWorkspaceId;
    setHold({
      pending: retry.pending,
      targetWorkspaceId: currentWorkspaceId,
      sourceWorkspaceId: prevHint ?? pageCw ?? null,
    });
    return;
  }

  if (retry.cleared) {
    setHold(null);
    await fetchApply();
    applyWorkspaceLanding(currentWorkspaceId);
  } else {
    setHold(null);
  }
}
