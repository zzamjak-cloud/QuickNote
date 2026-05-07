import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";

// 워크스페이스 전환 시 이전 워크스페이스에 속하던 페이지/DB 캐시를 제거한다.
// 로컬 스토어는 workspaceId 스코프가 없는 평면 맵이라, 새 워크스페이스 데이터를
// fetch 하기 전에 비워야 두 워크스페이스 데이터가 섞여 보이는 현상을 막을 수 있다.
// 초기 마운트(prev=null) 또는 동일 ID 일 때는 첫 페인트 캐시를 유지한다.
export function applyWorkspaceSwitch(
  prev: string | null,
  next: string | null,
): void {
  if (prev === null) return;
  if (prev === next) return;
  usePageStore.setState({ pages: {}, activePageId: null });
  useDatabaseStore.setState({ databases: {} });
}
