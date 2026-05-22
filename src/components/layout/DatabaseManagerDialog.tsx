import { useMemo, useState } from "react";
import { Database, RefreshCcw, Search, X } from "lucide-react";
import { listDatabases, useDatabaseStore } from "../../store/databaseStore";
import { useHistoryStore } from "../../store/historyStore";
import { usePageStore } from "../../store/pageStore";
import { useSettingsStore } from "../../store/settingsStore";
import { emptyPanelState } from "../../types/database";
import { isLCSchedulerDatabaseId } from "../../lib/scheduler/database";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useUiStore } from "../../store/uiStore";
import { permanentlyDeleteDatabaseRemote } from "../../lib/sync/trashApi";
import { markPermanentlyDeletedEntity } from "../../lib/sync/localDeleteGuards";
import { SimpleConfirmDialog } from "../ui/SimpleConfirmDialog";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function DatabaseManagerDialog({ open, onClose }: Props) {
  const dbList = useDatabaseStore(listDatabases);
  const restoreDatabaseFromHistoryEvent = useDatabaseStore(
    (s) => s.restoreDatabaseFromHistoryEvent,
  );
  const pages = usePageStore((s) => s.pages);
  const findFullPagePageIdForDatabase = usePageStore(
    (s) => s.findFullPagePageIdForDatabase,
  );
  const createPage = usePageStore((s) => s.createPage);
  const updateDoc = usePageStore((s) => s.updateDoc);
  const setActivePage = usePageStore((s) => s.setActivePage);
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const showToast = useUiStore((s) => s.showToast);
  const deletedDbRestorePoints = useHistoryStore((s) =>
    s.getDeletedDbRestorePoints(),
  );
  const purgeDatabaseHistory = useHistoryStore((s) => s.purgeDatabaseHistory);
  const [query, setQuery] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const [purgingIds, setPurgingIds] = useState<Record<string, boolean>>({});
  const [hiddenDeletedDbIds, setHiddenDeletedDbIds] = useState<Set<string>>(new Set());
  const [selectedDeletedIds, setSelectedDeletedIds] = useState<Set<string>>(new Set());
  const [pendingPurge, setPendingPurge] = useState<{
    databaseId: string;
    title: string;
    workspaceId: string;
  } | null>(null);
  const [pendingBulkPurge, setPendingBulkPurge] = useState(false);

  const activeDbIds = useMemo(
    () => new Set(dbList.map((d) => d.id)),
    [dbList],
  );
  const q = query.trim().toLowerCase();
  const visibleActive = dbList
    .filter((d) => d.meta.title.toLowerCase().includes(q))
    .sort((a, b) => {
      const aScheduler = isLCSchedulerDatabaseId(a.id);
      const bScheduler = isLCSchedulerDatabaseId(b.id);
      if (aScheduler !== bScheduler) return aScheduler ? -1 : 1;
      return b.meta.updatedAt - a.meta.updatedAt;
    });
  const visibleDeleted = deletedDbRestorePoints
    .filter((d) => !activeDbIds.has(d.databaseId))
    .filter((d) => !hiddenDeletedDbIds.has(d.databaseId))
    .filter((d) => d.title.toLowerCase().includes(q));

  const purgeDeletedDatabase = (databaseId: string, title: string) => {
    const targetWorkspaceId =
      visibleDeleted.find((d) => d.databaseId === databaseId)?.workspaceId
      ?? currentWorkspaceId;
    if (!targetWorkspaceId) {
      showToast("워크스페이스를 찾을 수 없습니다.", { kind: "error" });
      return;
    }
    setPendingPurge({
      databaseId,
      title: title || "제목 없음",
      workspaceId: targetWorkspaceId,
    });
  };

  const confirmPurgeDeletedDatabase = async () => {
    if (!pendingPurge) return;
    const { databaseId, workspaceId } = pendingPurge;
    setPendingPurge(null);
    setPurgingIds((prev) => ({ ...prev, [databaseId]: true }));
    try {
      await permanentlyDeleteDatabaseRemote(databaseId, workspaceId);
      // 서버에서 row 가 사라졌음을 확정 → 영구 tombstone 으로 어떤 재유입도 차단.
      markPermanentlyDeletedEntity("database", databaseId, workspaceId);
      purgeDatabaseHistory(databaseId);
      // 좀비 캐시가 active 영역에 남아있을 가능성 차단.
      useDatabaseStore.setState((s) => {
        if (!s.databases[databaseId]) return s;
        const next = { ...s.databases };
        delete next[databaseId];
        return { ...s, databases: next };
      });
      setHiddenDeletedDbIds((prev) => new Set(prev).add(databaseId));
      showToast("삭제된 데이터베이스를 영구삭제했습니다.", { kind: "success" });
    } catch (error) {
      console.error(error);
      showToast("영구삭제에 실패했습니다.", { kind: "error" });
    } finally {
      setPurgingIds((prev) => {
        const next = { ...prev };
        delete next[databaseId];
        return next;
      });
    }
  };

  const confirmBulkPurge = async () => {
    setPendingBulkPurge(false);
    const ids = Array.from(selectedDeletedIds);
    for (const databaseId of ids) {
      const targetWorkspaceId =
        visibleDeleted.find((d) => d.databaseId === databaseId)?.workspaceId
        ?? currentWorkspaceId;
      if (!targetWorkspaceId) continue;
      setPurgingIds((prev) => ({ ...prev, [databaseId]: true }));
      try {
        await permanentlyDeleteDatabaseRemote(databaseId, targetWorkspaceId);
        markPermanentlyDeletedEntity("database", databaseId, targetWorkspaceId);
        purgeDatabaseHistory(databaseId);
        useDatabaseStore.setState((s) => {
          if (!s.databases[databaseId]) return s;
          const next = { ...s.databases };
          delete next[databaseId];
          return { ...s, databases: next };
        });
        setHiddenDeletedDbIds((prev) => new Set(prev).add(databaseId));
      } catch (error) {
        console.error(error);
      } finally {
        setPurgingIds((prev) => {
          const next = { ...prev };
          delete next[databaseId];
          return next;
        });
      }
    }
    setSelectedDeletedIds(new Set());
    showToast(`${ids.length}개 데이터베이스를 영구삭제했습니다.`, { kind: "success" });
  };

  const openDatabase = (databaseId: string, title: string) => {
    const pageId =
      findFullPagePageIdForDatabase(databaseId) ??
      (() => {
        const id = createPage(title, null, { activate: false });
        updateDoc(id, {
          type: "doc",
          content: [
            {
              type: "databaseBlock",
              attrs: {
                databaseId,
                layout: "fullPage",
                view: "table",
                panelState: JSON.stringify(emptyPanelState()),
              },
            },
          ],
        });
        return id;
      })();
    setActivePage(pageId);
    setCurrentTabPage(pageId);
    onClose();
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
        aria-labelledby="qn-db-manager-title"
        className="flex h-[90vh] w-full max-w-3xl flex-col rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2
            id="qn-db-manager-title"
            className="flex items-center gap-2 text-xl font-bold text-zinc-900 dark:text-zinc-100"
          >
            <Database size={20} />
            데이터베이스 관리
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowDeleted(true)}
              className="rounded px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              🗑 삭제된 DB 보기
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
        <div className="mb-3 flex items-center gap-1.5 rounded-md bg-white px-2 py-1 ring-1 ring-zinc-200 focus-within:ring-zinc-400 dark:bg-zinc-950 dark:ring-zinc-800">
          <Search size={13} className="text-zinc-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="DB 검색"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {visibleActive.length === 0 ? (
            <div className="px-3 py-2.5 text-lg text-zinc-500">
              표시할 데이터베이스가 없습니다.
            </div>
          ) : (
            visibleActive.map((d) => {
              const fullPageId = findFullPagePageIdForDatabase(d.id);
              const fullPageTitle = fullPageId
                ? pages[fullPageId]?.title?.trim() || null
                : null;
              return (
              <div
                key={d.id}
                className="flex items-center justify-between gap-3 border-b border-zinc-100 px-3 py-2.5 text-lg last:border-b-0 dark:border-zinc-800"
              >
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate font-medium text-zinc-800 dark:text-zinc-100">
                    {d.meta.title}
                  </span>
                  {fullPageTitle ? (
                    <>
                      <span className="shrink-0 text-zinc-400" aria-hidden>
                        ·
                      </span>
                      <span className="min-w-0 truncate text-base text-zinc-500 dark:text-zinc-400">
                        {fullPageTitle}
                      </span>
                    </>
                  ) : null}
                  {isLCSchedulerDatabaseId(d.id) ? (
                    <span className="shrink-0 rounded bg-zinc-100 px-2 py-0.5 text-sm font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">
                      고정
                    </span>
                  ) : null}
                </span>
                {!isLCSchedulerDatabaseId(d.id) ? (
                  <button
                    type="button"
                    onClick={() => openDatabase(d.id, d.meta.title)}
                    className="shrink-0 rounded bg-blue-600 px-3 py-1.5 text-base text-white hover:bg-blue-700"
                  >
                    열기
                  </button>
                ) : null}
              </div>
            );
            })
          )}
        </div>
      </div>

      {/* 삭제된 DB 별도 중첩 모달 */}
      {showDeleted && (
        <div
          className="fixed inset-0 z-[530] flex items-center justify-center bg-black/40"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowDeleted(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="flex h-[80vh] w-full max-w-2xl flex-col rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5 dark:border-zinc-800">
              <span className="text-lg font-semibold">삭제된 데이터베이스</span>
              <button
                type="button"
                onClick={() => setShowDeleted(false)}
                className="text-zinc-400 hover:text-zinc-600"
              >
                ✕
              </button>
            </div>

            {/* 전체 선택 + 일괄 삭제 툴바 */}
            {visibleDeleted.length > 0 && (
              <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2 dark:border-zinc-800">
                <label className="flex cursor-pointer items-center gap-2 text-base text-zinc-500 select-none">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded"
                    checked={selectedDeletedIds.size === visibleDeleted.length}
                    onChange={(e) => {
                      setSelectedDeletedIds(
                        e.target.checked
                          ? new Set(visibleDeleted.map((d) => d.databaseId))
                          : new Set(),
                      );
                    }}
                  />
                  전체 선택
                  {selectedDeletedIds.size > 0 && ` (${selectedDeletedIds.size})`}
                </label>
                {selectedDeletedIds.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setPendingBulkPurge(true)}
                    className="rounded border border-red-300 px-2.5 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/30"
                  >
                    선택 영구삭제 ({selectedDeletedIds.size})
                  </button>
                )}
              </div>
            )}

            <div className="flex-1 overflow-y-auto">
              {visibleDeleted.length === 0 ? (
                <p className="p-4 text-center text-lg text-zinc-400">
                  삭제된 데이터베이스가 없습니다.
                </p>
              ) : (
                visibleDeleted.map((d) => (
                  <div
                    key={d.eventId}
                    className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2.5 last:border-b-0 dark:border-zinc-800"
                  >
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 shrink-0 rounded"
                      checked={selectedDeletedIds.has(d.databaseId)}
                      onChange={(e) => {
                        setSelectedDeletedIds((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(d.databaseId);
                          else next.delete(d.databaseId);
                          return next;
                        });
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-lg font-medium text-zinc-400 line-through">
                        {d.title}
                      </div>
                      <div className="text-base text-zinc-400">
                        {new Date(d.ts).toLocaleString("ko-KR")}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        restoreDatabaseFromHistoryEvent(d.databaseId, d.eventId);
                        setShowDeleted(false);
                      }}
                      className="inline-flex shrink-0 items-center gap-1 rounded border border-zinc-200 px-2.5 py-1.5 text-base hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    >
                      <RefreshCcw size={14} />
                      복구
                    </button>
                    <button
                      type="button"
                      onClick={() => void purgeDeletedDatabase(d.databaseId, d.title)}
                      disabled={Boolean(purgingIds[d.databaseId])}
                      className="inline-flex shrink-0 items-center gap-1 rounded border border-red-300 px-2.5 py-1.5 text-base text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/30"
                    >
                      {purgingIds[d.databaseId] ? "삭제중…" : "영구삭제"}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
      <SimpleConfirmDialog
        open={pendingPurge != null}
        title="데이터베이스 영구삭제"
        message={
          pendingPurge
            ? `「${pendingPurge.title}」 DB를 영구삭제합니다.\n복구할 수 없으며 DynamoDB에서도 제거됩니다.`
            : ""
        }
        confirmLabel="영구삭제"
        cancelLabel="취소"
        danger
        zIndex={560}
        onCancel={() => setPendingPurge(null)}
        onConfirm={() => void confirmPurgeDeletedDatabase()}
      />
      <SimpleConfirmDialog
        open={pendingBulkPurge}
        title="선택 항목 영구삭제"
        message={`선택한 ${selectedDeletedIds.size}개 DB를 모두 영구삭제합니다.\n복구할 수 없으며 DynamoDB에서도 제거됩니다.`}
        confirmLabel={`${selectedDeletedIds.size}개 영구삭제`}
        cancelLabel="취소"
        danger
        zIndex={560}
        onCancel={() => setPendingBulkPurge(false)}
        onConfirm={() => void confirmBulkPurge()}
      />
    </div>
  );
}
