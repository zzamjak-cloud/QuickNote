import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { getSyncEngine } from "./runtime";

// 워크스페이스 전환 시 이전 워크스페이스에 속하던 페이지/DB 캐시를 제거한다.
// 로컬 스토어는 workspaceId 스코프가 없는 평면 맵이라, 새 워크스페이스 데이터를
// fetch 하기 전에 비워야 두 워크스페이스 데이터가 섞여 보이는 현상을 막을 수 있다.
//
// 안전 장치: outbox 에 미전송 mutation 이 있으면 클리어를 보류한다.
// 그렇지 않으면 서버에 도달하지 못한 새 페이지가 영구 손실된다.
// 초기 마운트(prev=null)에서도 stale 캐시 혼입을 막기 위해 클리어를 허용한다.
export async function applyWorkspaceSwitch(
  prev: string | null,
  next: string | null,
): Promise<{ cleared: boolean; reason: string; pending: number }> {
  if (!next) return { cleared: false, reason: "missing-next-workspace", pending: 0 };
  if (prev === next) return { cleared: false, reason: "same-workspace", pending: 0 };
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
  usePageStore.setState({ pages: {}, activePageId: null });
  useDatabaseStore.setState({ databases: {} });
  return { cleared: true, reason: "switched", pending: 0 };
}
