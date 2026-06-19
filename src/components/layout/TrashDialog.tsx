import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, RefreshCcw, Search, Trash2, X } from "lucide-react";
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
import { useDatabaseStore } from "../../store/databaseStore";
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
  const databases = useDatabaseStore((s) => s.databases);
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
  // DB 필터: "all"=전체, "none"=일반 페이지(DB 아님), 그 외=databaseId
  const [dbFilter, setDbFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [restoringSelected, setRestoringSelected] = useState(false);
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

  // DB 필터 드롭다운 옵션 — 휴지통에 항목이 있는 DB 만 노출. 제목은 databaseStore 에서 해석.
  const dbOptions = useMemo(() => {
    const ids = new Set<string>();
    let hasNonDb = false;
    for (const p of items) {
      if (p.databaseId) ids.add(p.databaseId);
      else hasNonDb = true;
    }
    const opts = Array.from(ids)
      .map((id) => ({ value: id, label: databases[id]?.meta.title?.trim() || "데이터베이스" }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return { opts, hasNonDb };
  }, [items, databases]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((p) => {
      if (q && !(p.title ?? "").toLowerCase().includes(q)) return false;
      if (dbFilter === "all") return true;
      if (dbFilter === "none") return !p.databaseId;
      return p.databaseId === dbFilter;
    });
  }, [items, query, dbFilter]);

  // 필터/검색이 바뀌면 선택을 초기화한다 — 숨겨진(필터 밖) 항목이 선택에 남아 복원되는 사고 방지.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [dbFilter, query]);

  const filteredIds = useMemo(() => filteredItems.map((p) => p.id), [filteredItems]);
  const allFilteredSelected =
    filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id));

  const toggleSelectOne = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    // 전체 선택은 "현재 필터된 목록"에만 적용된다.
    setSelectedIds((prev) => {
      const everySelected = filteredIds.length > 0 && filteredIds.every((id) => prev.has(id));
      return everySelected ? new Set() : new Set(filteredIds);
    });
  }, [filteredIds]);

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

  const restoreSelected = async () => {
    if (!currentWorkspaceId || restoringSelected) return;
    const wsId = currentWorkspaceId;
    // 현재 필터된 목록 ∩ 선택 — 필터 밖(숨겨진) 항목은 절대 복원하지 않는다.
    const targets = filteredItems.filter((p) => selectedIds.has(p.id));
    if (targets.length === 0) return;
    setRestoringSelected(true);
    let ok = 0;
    let fail = 0;
    for (const p of targets) {
      try {
        clearLocalDeleteGuard("page", p.id, wsId);
        const restored = await restorePageRemote(p.id, wsId);
        applyRemotePageToStore(restored);
        setItems((prev) => prev.filter((x) => x.id !== p.id));
        ok += 1;
      } catch (e) {
        console.error(e);
        fail += 1;
      }
    }
    setSelectedIds(new Set());
    setRestoringSelected(false);
    showToast(
      fail > 0 ? `${ok}개 복원 / ${fail}개 실패` : `${ok}개 항목을 복원했습니다.`,
      { kind: fail > 0 ? "info" : "success" },
    );
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
          <div className="shrink-0 space-y-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-zinc-200 px-2 py-1.5 dark:border-zinc-700">
                <Search size={13} className="shrink-0 text-zinc-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="페이지 제목 검색"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400"
                />
              </div>
              <select
                value={dbFilter}
                onChange={(e) => setDbFilter(e.target.value)}
                className="shrink-0 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-700 outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                title="데이터베이스로 필터"
              >
                <option value="all">전체 DB</option>
                {dbOptions.hasNonDb ? <option value="none">일반 페이지</option> : null}
                {dbOptions.opts.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            {filteredItems.length > 0 ? (
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className="inline-flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
                >
                  <span
                    className={[
                      "inline-flex h-4 w-4 items-center justify-center rounded border",
                      allFilteredSelected
                        ? "border-blue-500 bg-blue-500 text-white"
                        : "border-zinc-400",
                    ].join(" ")}
                  >
                    {allFilteredSelected ? <Check size={11} strokeWidth={3} /> : null}
                  </span>
                  전체 선택{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
                </button>
                {selectedIds.size > 0 ? (
                  <button
                    type="button"
                    onClick={() => void restoreSelected()}
                    disabled={restoringSelected}
                    className="inline-flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    <RefreshCcw size={11} />
                    {restoringSelected ? "복원 중…" : `선택 복원 (${selectedIds.size})`}
                  </button>
                ) : null}
              </div>
            ) : null}
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
                      <button
                        type="button"
                        onClick={() => toggleSelectOne(p.id)}
                        aria-label="선택"
                        className={[
                          "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                          selectedIds.has(p.id)
                            ? "border-blue-500 bg-blue-500 text-white"
                            : "border-zinc-400",
                        ].join(" ")}
                      >
                        {selectedIds.has(p.id) ? <Check size={11} strokeWidth={3} /> : null}
                      </button>
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
