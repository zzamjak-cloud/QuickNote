import { usePageStore } from "../../store/pageStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { useDatabaseRowIndexStore } from "../../store/databaseRowIndexStore";
import { ensurePageContentLoaded } from "../sync/pageContentLoad";
import { resolveDatabaseRowRemoteKey } from "../sync/externalProtectedDatabaseLoad";

/**
 * 인라인 DB(특히 원본 DB 연결)의 cached-only 행은 row index 캐시에만 있고 pageStore 에는
 * 본문이 적재돼 있지 않다. 이 상태에서 셀을 쓰면 setPageDbCell 이 `pages[pageId]` 부재로
 * 조용히 no-op 되어 변경이 전혀 반영되지 않는다(스토어/표시/서버 enqueue 모두 누락).
 *
 * 편집 직전 행 페이지 본문을 적재해 setPageDbCell 이 정상 동작하도록 보장한다.
 * 이미 적재돼 있으면(PropertyPanel·피크뷰 등) 즉시 true 를 반환해 동작이 동일하다.
 */
export async function ensureRowPageLoadedForEdit(
  databaseId: string,
  pageId: string,
): Promise<boolean> {
  if (usePageStore.getState().pages[pageId]) return true;

  const currentWorkspaceId = useWorkspaceStore.getState().currentWorkspaceId;
  const databaseWorkspaceId =
    useDatabaseStore.getState().databases[databaseId]?.meta.workspaceId ?? null;
  const rowIndexKey = resolveDatabaseRowRemoteKey(databaseId, currentWorkspaceId);
  const rowIndexWorkspaceId = rowIndexKey
    ? useDatabaseRowIndexStore
        .getState()
        .snapshotsByKey[rowIndexKey]?.rows.find((row) => row.pageId === pageId)
        ?.workspaceId ?? null
    : null;
  const workspaceId = rowIndexWorkspaceId ?? databaseWorkspaceId ?? currentWorkspaceId;

  return ensurePageContentLoaded({
    pageId,
    workspaceId,
    source: "database-cell-edit",
  });
}
