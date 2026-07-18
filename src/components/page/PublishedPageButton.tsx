import { useEffect } from "react";
import { Globe } from "lucide-react";
import { getPagePublishStatusApi } from "../../lib/sync/publishApi";
import {
  getPagePublishStatusRevision,
  usePagePublishStatusStore,
} from "../../store/pagePublishStatusStore";

type Props = {
  pageId: string;
  onOpen: () => void;
};

export function PublishedPageButton({ pageId, onOpen }: Props) {
  const published = usePagePublishStatusStore(
    (state) => state.statusByPageId[pageId]?.published ?? false,
  );
  const applyFetchedStatus = usePagePublishStatusStore(
    (state) => state.applyFetchedStatus,
  );

  useEffect(() => {
    let canceled = false;
    const expectedRevision = getPagePublishStatusRevision(pageId);

    getPagePublishStatusApi(pageId)
      .then((status) => {
        if (!canceled) {
          applyFetchedStatus(pageId, status.published, expectedRevision);
        }
      })
      .catch(() => {
        // 상태 확인에 실패한 버튼은 게시 여부를 추측하지 않고 숨긴다.
        if (!canceled) applyFetchedStatus(pageId, false, expectedRevision);
      });

    return () => {
      canceled = true;
    };
  }, [applyFetchedStatus, pageId]);

  if (!published) return null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="shrink-0 rounded-md p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
      aria-label="웹 게시 설정 열기"
      title="웹 게시 설정 열기"
    >
      <Globe size={22} strokeWidth={1.75} />
    </button>
  );
}
