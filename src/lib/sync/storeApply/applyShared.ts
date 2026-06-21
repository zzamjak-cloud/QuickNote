// 워크스페이스 가드·캐시 워크스페이스 해석 sink. page·database·comment reducer 가 공유한다.
import { useWorkspaceStore } from "../../../store/workspaceStore";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../scheduler/scope";

/**
 * 구독 레이스·백엔드 오류로 다른 워크스페이스 스냅샷이 내려올 때 로컬 캐시가 오염되지 않게 한다.
 * commentApply 등 분리된 reducer 도 공유한다.
 */
export function shouldApplyRemoteSnapshot(remoteWorkspaceId: string | null | undefined): boolean {
  if (remoteWorkspaceId == null || remoteWorkspaceId === "") {
    console.warn("[sync] storeApply: workspaceId 없는 원격 항목은 적용하지 않음");
    return false;
  }
  // LC 스케줄러는 공용 워크스페이스이므로 현재 선택 워크스페이스와 무관하게 반영한다.
  if (remoteWorkspaceId === LC_SCHEDULER_WORKSPACE_ID) return true;
  const current = useWorkspaceStore.getState().currentWorkspaceId;
  if (!current) return true;
  if (current !== remoteWorkspaceId) {
    console.warn("[sync] storeApply: 현재 워크스페이스와 다른 원격 데이터 무시", {
      currentWorkspaceId: current,
      remoteWorkspaceId,
    });
    return false;
  }
  return true;
}

export function resolveNextCacheWorkspaceId(
  current: string | null,
  remoteWorkspaceId: string,
): string | null {
  return remoteWorkspaceId === LC_SCHEDULER_WORKSPACE_ID ? current : remoteWorkspaceId;
}
