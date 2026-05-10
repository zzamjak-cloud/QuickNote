import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { useSettingsStore } from "../../store/settingsStore";
import { getSyncEngine } from "./runtime";

// 워크스페이스 전환 시 이전 워크스페이스에 속하던 페이지/DB 캐시를 제거한다.
// 로컬 스토어는 workspaceId 스코프가 없는 평면 맵이라, 새 워크스페이스 데이터를
// fetch 하기 전에 비워야 두 워크스페이스 데이터가 섞여 보이는 현상을 막을 수 있다.
//
// 안전 장치: outbox 에 미전송 mutation 이 있으면 클리어를 보류한다.
// 그렇지 않으면 서버에 도달하지 못한 새 페이지가 영구 손실된다.
//
function hasLocalWorkspaceCache(): boolean {
  return (
    Object.keys(usePageStore.getState().pages).length > 0 ||
    Object.keys(useDatabaseStore.getState().databases).length > 0
  );
}

export function cacheBelongsToWorkspace(workspaceId: string): boolean {
  const hasPageCache = Object.keys(usePageStore.getState().pages).length > 0;
  const hasDatabaseCache =
    Object.keys(useDatabaseStore.getState().databases).length > 0;
  const pageCacheWorkspaceId = usePageStore.getState().cacheWorkspaceId;
  const databaseCacheWorkspaceId = useDatabaseStore.getState().cacheWorkspaceId;
  if (hasPageCache && pageCacheWorkspaceId !== workspaceId) return false;
  if (hasDatabaseCache && databaseCacheWorkspaceId !== workspaceId) return false;
  return hasPageCache || hasDatabaseCache;
}

export function workspaceCacheNeedsPrepaintClear(workspaceId: string | null): boolean {
  return Boolean(
    workspaceId && hasLocalWorkspaceCache() && !cacheBelongsToWorkspace(workspaceId),
  );
}

function clearWorkspaceScopedStores(nextWorkspaceId: string): void {
  usePageStore.setState({
    pages: {},
    activePageId: null,
    cacheWorkspaceId: nextWorkspaceId,
  });
  useDatabaseStore.setState({
    databases: {},
    cacheWorkspaceId: nextWorkspaceId,
  });
  useSettingsStore.setState({
    tabs: [{ pageId: null }],
    activeTabIndex: 0,
  });
}

// prev=null 은 부트스트랩 첫 실행(세션 시작·새로고침 직후)을 의미한다.
// 구버전 캐시(cacheWorkspaceId 없음) 또는 다른 워크스페이스 캐시는 첫 페인트 전에 제거한다.
// 같은 워크스페이스임을 확인할 수 있는 캐시만 유지하여 빈 화면과 데이터 오염을 모두 피한다.
export async function applyWorkspaceSwitch(
  prev: string | null,
  next: string | null,
): Promise<{ cleared: boolean; reason: string; pending: number }> {
  if (!next) return { cleared: false, reason: "missing-next-workspace", pending: 0 };
  const initialCacheMismatch =
    prev === null && workspaceCacheNeedsPrepaintClear(next);
  if (prev === next && !initialCacheMismatch) {
    return { cleared: false, reason: "same-workspace", pending: 0 };
  }
  if (prev === null && !initialCacheMismatch) {
    return { cleared: false, reason: "initial-bootstrap", pending: 0 };
  }
  let pending = 0;
  try {
    const engine = await getSyncEngine();
    pending = await engine.peekPending();
  } catch {
    /* outbox 조회 실패 시 클리어 보류 쪽으로 안전 처리 */
  }
  if (pending > 0) {
    console.warn(
      "[sync] outbox 미전송 mutation 으로 워크스페이스 캐시 클리어 보류 (데이터 손실 방지). 강제 비우려면 콘솔에서 `await __QN_clearOutbox()`.",
      { pending },
    );
    return { cleared: false, reason: "pending-outbox", pending };
  }
  clearWorkspaceScopedStores(next);
  return {
    cleared: true,
    reason: initialCacheMismatch ? "initial-cache-mismatch" : "switched",
    pending: 0,
  };
}
