import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCcw, Search, Trash2, X } from "lucide-react";
import { applyRemotePageToStore } from "../../lib/sync/storeApply";
import {
  fetchTrashedPagesBatch,
  permanentlyDeletePageRemote,
  restorePageRemote,
} from "../../lib/sync/trashApi";
import { runChunkedPermanentDelete } from "../../lib/sync/chunkedPermanentDelete";
import { getSyncEngine } from "../../lib/sync/runtime";
import {
  clearLocalDeleteGuard,
  isPermanentlyDeletedEntity,
  markPermanentlyDeletedEntity,
} from "../../lib/sync/localDeleteGuards";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { usePageStore } from "../../store/pageStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useUiStore } from "../../store/uiStore";
import { SimpleConfirmDialog } from "../ui/SimpleConfirmDialog";

type Props = {
  open: boolean;
  onClose: () => void;
};

const RETENTION_DAYS = 30;

export function TrashDialog({ open, onClose }: Props) {
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const setActivePage = usePageStore((s) => s.setActivePage);
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);
  const removeFavoritesForPages = useSettingsStore((s) => s.removeFavoritesForPages);
  const showToast = useUiStore((s) => s.showToast);

  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [items, setItems] = useState<
    Awaited<ReturnType<typeof fetchTrashedPagesBatch>>["items"]
  >([]);
  /** 다음 배치 조회용 서버 커서 */
  const [cursor, setCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [confirmEmptyOpen, setConfirmEmptyOpen] = useState(false);
  const [emptying, setEmptying] = useState(false);
  /** 비우기 진행률 — null=비실행, { done, total } */
  const [emptyProgress, setEmptyProgress] = useState<{ done: number; total: number } | null>(null);

  const filterRowsOfPermanentlyDeletedDatabases = useCallback(
    (
      source: Awaited<ReturnType<typeof fetchTrashedPagesBatch>>["items"],
      workspaceId: string,
    ) =>
      source.filter((item) => {
        // 이미 영구삭제 확정된 페이지는 서버 eventual-consistency 로 다시 내려와도 숨긴다(되살아남 방지).
        if (isPermanentlyDeletedEntity("page", item.id, workspaceId)) return false;
        const dbId = item.databaseId;
        if (!dbId) return true;
        return !isPermanentlyDeletedEntity("database", dbId, workspaceId);
      }),
    [],
  );

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((p) => (p.title ?? "").toLowerCase().includes(q));
  }, [items, query]);

  const loadFirst = useCallback(async () => {
    if (!currentWorkspaceId) return;
    setLoading(true);
    setCursor(null);
    try {
      // 첫 배치만 로드하고 나머지는 "더보기"(loadMore)로 지연 로드한다.
      // 이전엔 열자마자 전체 배치를 순차 스윕해 휴지통 항목이 많을수록 매우 느렸다.
      const batch = await fetchTrashedPagesBatch(currentWorkspaceId);
      setItems(filterRowsOfPermanentlyDeletedDatabases(batch.items, currentWorkspaceId));
      setCursor(batch.nextToken);
    } catch (e) {
      console.error(e);
      showToast("휴지통 목록을 불러오지 못했습니다.", { kind: "error" });
      setItems([]);
      setCursor(null);
    } finally {
      setLoading(false);
    }
  }, [currentWorkspaceId, filterRowsOfPermanentlyDeletedDatabases, showToast]);

  const loadMore = useCallback(async () => {
    if (!currentWorkspaceId || cursor === null) return;
    setLoadingMore(true);
    try {
      const batch = await fetchTrashedPagesBatch(currentWorkspaceId, cursor);
      setItems((prev) =>
        filterRowsOfPermanentlyDeletedDatabases([...prev, ...batch.items], currentWorkspaceId),
      );
      setCursor(batch.nextToken);
    } catch (e) {
      console.error(e);
      showToast("추가 목록을 불러오지 못했습니다.", { kind: "error" });
    } finally {
      setLoadingMore(false);
    }
  }, [currentWorkspaceId, cursor, filterRowsOfPermanentlyDeletedDatabases, showToast]);

  useEffect(() => {
    if (!open) return;
    void loadFirst();
  }, [open, loadFirst]);

  const restore = async (id: string, title: string) => {
    if (!currentWorkspaceId) return;
    try {
      // 사용자가 명시적으로 복원 요청 → 기존 로컬 삭제 가드 제거.
      clearLocalDeleteGuard("page", id, currentWorkspaceId);
      const p = await restorePageRemote(id, currentWorkspaceId);
      applyRemotePageToStore(p);
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

  const emptyTrash = async () => {
    if (!currentWorkspaceId || emptying) return;
    const wsId = currentWorkspaceId;
    setEmptying(true);
    setConfirmEmptyOpen(false);
    setEmptyProgress({ done: 0, total: 0 });

    // 서버 휴지통을 항상 "처음부터" 50건씩 가져와 청크(동시 4) 삭제하고, 빌 때까지 반복한다.
    // - UI 에 로드된 일부만 지우던 기존 버그(미삭제 잔여) 제거: 서버 기준으로 끝까지 비운다.
    // - 한 번에 전부가 아니라 배치 단위 순차 처리라 대량에서도 병목/크래시 위험이 낮다.
    const successIds: string[] = [];
    let deletedTotal = 0;
    let failedTotal = 0;
    try {
      while (true) {
        const batch = await fetchTrashedPagesBatch(wsId, null);
        const targets = batch.items
          .map((item) => item.id)
          .filter(Boolean)
          .map((id) => ({ id, workspaceId: wsId }));
        if (targets.length === 0) break;

        const { deletedCount, failedCount } = await runChunkedPermanentDelete(targets, {
          deleteRemote: permanentlyDeletePageRemote,
          onItemSuccess: ({ id, workspaceId }) => {
            markPermanentlyDeletedEntity("page", id, workspaceId);
            successIds.push(id);
            deletedTotal += 1;
            setEmptyProgress({ done: deletedTotal, total: deletedTotal });
            // 성공 즉시 리스트에서 제거 — 사용자가 실시간으로 줄어드는 걸 확인
            setItems((prev) => prev.filter((x) => x.id !== id));
          },
        });
        failedTotal += failedCount;
        // 진전이 없으면(전부 실패) 무한 루프 방지를 위해 종료.
        if (deletedCount === 0) break;
      }
    } catch (e) {
      console.error(e);
    }

    // 영구삭제된 페이지의 잔여 outbox(upsert/softDelete) 제거 — flush 로 인한 서버 재생성(되살아남) 차단.
    if (successIds.length > 0) {
      try {
        const engine = await getSyncEngine();
        await engine.purgePendingForPageIds(new Set(successIds));
      } catch (e) {
        console.error(e);
      }
      // 좀비 로컬 캐시 정리 (성공한 id 만)
      usePageStore.setState((s) => {
        let nextPages = s.pages;
        let changed = false;
        for (const pid of successIds) {
          if (!nextPages[pid]) continue;
          if (nextPages === s.pages) nextPages = { ...s.pages };
          delete nextPages[pid];
          changed = true;
        }
        if (!changed) return s;
        return { ...s, pages: nextPages };
      });
      removeFavoritesForPages(successIds);
    }

    setEmptying(false);
    setEmptyProgress(null);

    if (failedTotal > 0) {
      showToast(`${deletedTotal}개 영구삭제 / ${failedTotal}개 실패`, {
        kind: deletedTotal === 0 ? "error" : "info",
      });
    } else {
      showToast(`${deletedTotal}개 영구삭제됨`, { kind: "success" });
    }

    // 삭제 후 남은(실패) 휴지통 항목을 재조회.
    void loadFirst();
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
              className="flex items-center gap-2 text-xl font-bold text-zinc-900 dark:text-zinc-100"
            >
              <Trash2 size={20} />
              휴지통
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              삭제된 페이지는 {RETENTION_DAYS}일 동안만 보관되며, 이후 영구
              삭제됩니다.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setConfirmEmptyOpen(true)}
              disabled={loading || emptying || items.length === 0}
              className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-red-900/70 dark:text-red-300 dark:hover:bg-red-950/40"
            >
              <Trash2 size={12} />
              {emptying && emptyProgress
                ? `${emptyProgress.done}개 삭제중`
                : "비우기"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
            <div className="flex items-center gap-2 rounded-md border border-zinc-200 px-2 py-1.5 dark:border-zinc-700">
              <Search size={13} className="shrink-0 text-zinc-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="페이지 제목 검색"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {loading ? (
              <p className="px-2 py-6 text-center text-sm text-zinc-500">
                불러오는 중…
              </p>
            ) : filteredItems.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-zinc-500">
                {query.trim() ? "검색 결과가 없습니다." : "휴지통이 비어 있습니다."}
              </p>
            ) : (
              <ul>
                {filteredItems.map((p) => {
                  const deletedAt = p.deletedAt
                    ? new Date(p.deletedAt).toLocaleString("ko-KR")
                    : "";
                  const title = p.title?.trim() || "제목 없음";
                  return (
                    <li
                      key={p.id}
                      className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2 last:border-b-0 dark:border-zinc-800"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                        {p.icon ? (
                          <span className="mr-1">{p.icon}</span>
                        ) : null}
                        {title}
                      </span>
                      <span className="shrink-0 text-xs text-zinc-400">{deletedAt}</span>
                      <button
                        type="button"
                        onClick={() => void restore(p.id, title)}
                        className="inline-flex shrink-0 items-center gap-1 rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700"
                      >
                        <RefreshCcw size={11} />
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
      <SimpleConfirmDialog
        open={confirmEmptyOpen}
        title="휴지통 비우기"
        message="휴지통의 모든 페이지를 영구삭제합니다. 이 작업은 복구할 수 없고, 서버 데이터도 함께 삭제됩니다."
        confirmLabel={emptying ? "삭제 중" : "영구삭제"}
        danger
        zIndex={540}
        onCancel={() => {
          if (!emptying) setConfirmEmptyOpen(false);
        }}
        onConfirm={() => void emptyTrash()}
      />
    </div>
  );
}
