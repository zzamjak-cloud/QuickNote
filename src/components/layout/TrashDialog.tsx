import { useCallback, useEffect, useState } from "react";
import { RefreshCcw } from "lucide-react";
import { applyRemotePageToStore } from "../../lib/sync/storeApply";
import {
  fetchTrashedPagesBatch,
  restorePageRemote,
} from "../../lib/sync/trashApi";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { usePageStore } from "../../store/pageStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useUiStore } from "../../store/uiStore";

type Props = {
  open: boolean;
  onClose: () => void;
};

const RETENTION_DAYS = 30;

export function TrashDialog({ open, onClose }: Props) {
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const setActivePage = usePageStore((s) => s.setActivePage);
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);
  const showToast = useUiStore((s) => s.showToast);

  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [items, setItems] = useState<
    Awaited<ReturnType<typeof fetchTrashedPagesBatch>>["items"]
  >([]);
  /** 다음 배치 조회용 서버 커서 */
  const [cursor, setCursor] = useState<string | null>(null);

  const loadFirst = useCallback(async () => {
    if (!currentWorkspaceId) return;
    setLoading(true);
    setCursor(null);
    try {
      const batch = await fetchTrashedPagesBatch(currentWorkspaceId);
      setItems(batch.items);
      setCursor(batch.nextToken);
    } catch (e) {
      console.error(e);
      showToast("휴지통 목록을 불러오지 못했습니다.", { kind: "error" });
      setItems([]);
      setCursor(null);
    } finally {
      setLoading(false);
    }
  }, [currentWorkspaceId, showToast]);

  const loadMore = useCallback(async () => {
    if (!currentWorkspaceId || cursor === null) return;
    setLoadingMore(true);
    try {
      const batch = await fetchTrashedPagesBatch(currentWorkspaceId, cursor);
      setItems((prev) => [...prev, ...batch.items]);
      setCursor(batch.nextToken);
    } catch (e) {
      console.error(e);
      showToast("추가 목록을 불러오지 못했습니다.", { kind: "error" });
    } finally {
      setLoadingMore(false);
    }
  }, [currentWorkspaceId, cursor, showToast]);

  useEffect(() => {
    if (!open) return;
    void loadFirst();
  }, [open, loadFirst]);

  const restore = async (id: string, title: string) => {
    if (!currentWorkspaceId) return;
    try {
      const p = await restorePageRemote(id, currentWorkspaceId);
      applyRemotePageToStore(p, { skipBlockCommentNotifications: true });
      setItems((prev) => prev.filter((x) => x.id !== id));
      setActivePage(id);
      setCurrentTabPage(id);
      showToast(`「${title || "제목 없음"}」 페이지를 복원했습니다.`, {
        kind: "success",
      });
    } catch (e) {
      console.error(e);
      showToast("복원에 실패했습니다. 보관 기간이 지났을 수 있습니다.", {
        kind: "error",
      });
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[430] flex items-center justify-center bg-black/45 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="qn-trash-title"
        className="flex max-h-[min(32rem,85vh)] w-full max-w-lg flex-col rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div>
            <h2
              id="qn-trash-title"
              className="text-sm font-semibold text-zinc-900 dark:text-zinc-100"
            >
              휴지통
            </h2>
            <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
              삭제된 페이지는 {RETENTION_DAYS}일 동안만 보관되며, 이후 영구
              삭제됩니다. (매일 서버에서 정리)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            닫기
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {loading ? (
              <p className="px-2 py-6 text-center text-xs text-zinc-500">
                불러오는 중…
              </p>
            ) : items.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-zinc-500">
                휴지통이 비어 있습니다.
              </p>
            ) : (
              <ul className="space-y-1">
                {items.map((p) => {
                  const deletedAt = p.deletedAt
                    ? new Date(p.deletedAt).toLocaleString("ko-KR")
                    : "";
                  const title = p.title?.trim() || "제목 없음";
                  return (
                    <li
                      key={p.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-zinc-100 px-3 py-2 dark:border-zinc-800"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-100">
                          {p.icon ? (
                            <span className="mr-1">{p.icon}</span>
                          ) : null}
                          {title}
                        </div>
                        <div className="text-[10px] text-zinc-500">
                          삭제: {deletedAt}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void restore(p.id, title)}
                        className="inline-flex shrink-0 items-center gap-1 rounded border border-zinc-200 px-2 py-1 text-[11px] hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
                      >
                        <RefreshCcw size={12} />
                        복원
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {cursor !== null && items.length > 0 ? (
            <div className="shrink-0 border-t border-zinc-200 p-2 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="w-full rounded-md border border-zinc-200 py-2 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                {loadingMore ? "불러오는 중…" : "더보기"}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
