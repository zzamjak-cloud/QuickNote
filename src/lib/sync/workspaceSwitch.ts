import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { getSyncEngine } from "./runtime";

// 워크스페이스 전환 시 이전 워크스페이스에 속하던 페이지/DB 캐시를 제거한다.
// 로컬 스토어는 workspaceId 스코프가 없는 평면 맵이라, 새 워크스페이스 데이터를
// fetch 하기 전에 비워야 두 워크스페이스 데이터가 섞여 보이는 현상을 막을 수 있다.
//
// 안전 장치: outbox 에 미전송 mutation 이 있으면 클리어를 보류한다.
// 그렇지 않으면 서버에 도달하지 못한 새 페이지가 영구 손실된다.
// 초기 마운트(prev=null) 또는 동일 ID 일 때는 첫 페인트 캐시를 유지한다.
export async function applyWorkspaceSwitch(
  prev: string | null,
  next: string | null,
): Promise<{ cleared: boolean; reason: string }> {
  if (prev === null) return { cleared: false, reason: "initial-mount" };
  if (prev === next) return { cleared: false, reason: "same-workspace" };
  let pending = 0;
  try {
    const engine = await getSyncEngine();
    pending = await engine.peekPending();
  } catch {
    /* outbox 조회 실패 시 클리어 보류 쪽으로 안전하게 처리 */
  }
  if (pending > 0) {
    console.warn(
      "[sync] outbox 에 미전송 mutation 이 남아있어 워크스페이스 캐시 클리어를 보류합니다 (데이터 손실 방지).",
      { pending },
    );
    return { cleared: false, reason: "pending-outbox" };
  }
  usePageStore.setState({ pages: {}, activePageId: null });
  useDatabaseStore.setState({ databases: {} });
  return { cleared: true, reason: "switched" };
}
