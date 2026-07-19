// 이미 게시된 페이지의 공개 레이아웃 스냅샷을 현재 clientPrefs 기준으로 갱신한다.
import { usePagePublishStatusStore } from "../../store/pagePublishStatusStore";
import { flushClientPrefsToServerNow } from "./clientPrefsSync";
import { getPagePublishStatusApi, publishPageApi } from "./publishApi";

export async function refreshPublishedLayoutSnapshot(
  pageId: string | null,
): Promise<boolean> {
  if (!pageId) return false;

  let published =
    usePagePublishStatusStore.getState().statusByPageId[pageId]?.published;
  if (published === undefined) {
    const status = await getPagePublishStatusApi(pageId);
    usePagePublishStatusStore
      .getState()
      .setPublished(pageId, status.published);
    published = status.published;
  }
  if (!published) return false;

  await flushClientPrefsToServerNow();
  const refreshed = await publishPageApi(pageId);
  usePagePublishStatusStore
    .getState()
    .setPublished(pageId, refreshed.published);
  return refreshed.published;
}
