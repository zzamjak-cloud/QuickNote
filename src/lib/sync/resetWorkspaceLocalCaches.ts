import { useDatabaseRowRemoteStore } from "../../store/databaseRowRemoteStore";
import { usePageContentLoadStore } from "../../store/pageContentLoadStore";
import { usePageMetaRemoteStore } from "../../store/pageMetaRemoteStore";
import { useSyncWatermarkStore } from "../../store/syncWatermarkStore";
import { resetDatabaseRowLoadSessionState } from "./externalProtectedDatabaseLoad";

// 워크스페이스의 로컬 동기화 캐시 + 워터마크를 함께 초기화한다.
//
// 왜 한 함수로 모으나:
// persist 데이터 store(database/page/pageMeta…)의 스키마 버전을 bump 하거나 캐시를 비울 때,
// 별도 persist store 인 syncWatermark 를 **함께** 리셋하지 않으면 다음 페치가 delta 로 떨어져
// 비워진 데이터가 영영 다시 안 와 유실된다(댓글 사라짐·유령 페이지 회귀 패밀리의 근본 원인).
// 캐시 비움과 워터마크 리셋은 항상 짝이어야 하므로 단일 진입점으로 강제한다.
//
// 사용처: cache-repair-revision / 루트페이지 repair / 향후 persist 스키마 bump 복구 경로.
// 호출 후에는 반드시 forceMetaBaseline(=전체 기준선) 페치로 데이터를 다시 채워야 한다.
export function resetWorkspaceLocalCaches(workspaceId: string): void {
  resetDatabaseRowLoadSessionState();
  useDatabaseRowRemoteStore.getState().clear();
  usePageContentLoadStore.getState().clear();
  usePageMetaRemoteStore.getState().clearWorkspace(workspaceId);
  // 워터마크 리셋이 빠지면 delta 페치가 비워진 데이터를 건너뛴다 — 절대 누락 금지.
  useSyncWatermarkStore.getState().reset(workspaceId);
}
