import { usePageMetaRemoteStore } from "../../store/pageMetaRemoteStore";
import { fetchPageMetasBatch } from "./bootstrap";
import { applyRemotePageMetasToStore } from "./storeApply";
import { refreshWorkspaceSnapshot } from "./workspaceSwitch";

const inFlightByWorkspaceId = new Map<string, Promise<boolean>>();

export async function loadMorePageMetas(workspaceId: string): Promise<boolean> {
  const store = usePageMetaRemoteStore.getState();
  const nextToken = store.nextTokenByWorkspaceId[workspaceId];
  if (!nextToken) return false;
  const existing = inFlightByWorkspaceId.get(workspaceId);
  if (existing) return existing;

  const task = (async () => {
    store.setLoading(workspaceId, true);
    try {
      const batch = await fetchPageMetasBatch({ workspaceId, nextToken });
      applyRemotePageMetasToStore(batch.items);
      usePageMetaRemoteStore.getState().setNextToken(workspaceId, batch.nextToken ?? null);
      refreshWorkspaceSnapshot(workspaceId);
      return batch.items.length > 0;
    } catch (error) {
      console.warn("[QN_PAGE_META] load-more-failed", { workspaceId, error });
      return false;
    } finally {
      usePageMetaRemoteStore.getState().setLoading(workspaceId, false);
      inFlightByWorkspaceId.delete(workspaceId);
    }
  })();

  inFlightByWorkspaceId.set(workspaceId, task);
  return task;
}

export function hasMorePageMetas(workspaceId: string): boolean {
  const nextToken = usePageMetaRemoteStore.getState().nextTokenByWorkspaceId[workspaceId];
  return Boolean(nextToken);
}
