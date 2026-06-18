import { useEffect, useMemo, useState } from "react";
import { Database, RefreshCcw, Search, X } from "lucide-react";
import { listDatabases, useDatabaseStore } from "../../store/databaseStore";
import { useHistoryStore } from "../../store/historyStore";
import { useServerTrashedDatabaseStore } from "../../store/serverTrashedDatabaseStore";
import { usePageStore } from "../../store/pageStore";
import { useSettingsStore } from "../../store/settingsStore";
import { isLCSchedulerDatabaseId, isProtectedDatabaseId, ensureLCSchedulerDatabase } from "../../lib/scheduler/database";
import { ensureLCMilestoneDatabase } from "../../lib/scheduler/milestoneDatabase";
import { ensureLCFeatureDatabase } from "../../lib/scheduler/featureDatabase";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../lib/scheduler/scope";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useUiStore } from "../../store/uiStore";
import { permanentlyDeleteDatabaseRemote } from "../../lib/sync/trashApi";
import { koreanIncludes } from "../../lib/koreanSearch";
import { markPermanentlyDeletedEntity } from "../../lib/sync/localDeleteGuards";
import { runChunkedPermanentDelete } from "../../lib/sync/chunkedPermanentDelete";
import { SimpleConfirmDialog } from "../ui/SimpleConfirmDialog";

type Props = {
  open: boolean;
  onClose: () => void;
};

function collectReferencedDatabaseIds(value: unknown, out: Set<string>): void {
  if (!value || typeof value !== "object") return;
  const node = value as Record<string, unknown>;
  const attrs = node.attrs as Record<string, unknown> | undefined;
  const type = typeof node.type === "string" ? node.type : "";
  const databaseId = String(attrs?.databaseId ?? "");
  if (
    (type === "databaseBlock" || type === "buttonBlock") &&
    databaseId
  ) {
    out.add(databaseId);
  }
  const content = node.content;
  if (!Array.isArray(content)) return;
  for (const child of content) collectReferencedDatabaseIds(child, out);
}

export function DatabaseManagerDialog({ open, onClose }: Props) {
  const dbList = useDatabaseStore(listDatabases);
  const databases = useDatabaseStore((s) => s.databases);
  const dbTemplates = useDatabaseStore((s) => s.dbTemplates);
  const deleteDatabase = useDatabaseStore((s) => s.deleteDatabase);
  const pages = usePageStore((s) => s.pages);
  const findFullPagePageIdForDatabase = usePageStore(
    (s) => s.findFullPagePageIdForDatabase,
  );
  const setActivePage = usePageStore((s) => s.setActivePage);
  const setCurrentTabDatabase = useSettingsStore((s) => s.setCurrentTabDatabase);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const showToast = useUiStore((s) => s.showToast);
  // 삭제된 DB 목록·복원은 서버 권위(휴지통). 기존 로컬 getDeletedDbRestorePoints 대체.
  const trashedDatabases = useServerTrashedDatabaseStore((s) =>
    currentWorkspaceId ? s.getTrashedDatabases(currentWorkspaceId) : [],
  );
  const fetchTrashedDatabases = useServerTrashedDatabaseStore((s) => s.fetchTrashedDatabases);
  const restoreTrashedDatabase = useServerTrashedDatabaseStore((s) => s.restoreTrashedDatabase);
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
  /** 일괄 영구삭제 진행률 — null=비실행, { done, total } */
  const [bulkPurgeProgress, setBulkPurgeProgress] = useState<{ done: number; total: number } | null>(null);
  // ── 숨겨진 빠른 삭제 기능 (활성 DB 일괄 삭제) ──
  // 제목 왼쪽 DB 아이콘 더블클릭으로 활성화되는 테스트용 단축 기능.
  /** 활성 DB 리스트에 체크박스를 노출하는 모드 여부 */
  const [activeCheckboxMode, setActiveCheckboxMode] = useState(false);
  /** 체크박스 활성화 확인 팝업 표시 여부 */
  const [pendingEnableCheckbox, setPendingEnableCheckbox] = useState(false);
  /** 체크된 활성 DB id 집합 */
  const [selectedActiveIds, setSelectedActiveIds] = useState<Set<string>>(new Set());
  /** 활성 DB 일괄 삭제 확인 팝업 표시 여부 */
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false);

  // 다이얼로그가 닫히면 숨겨진 삭제 모드 상태를 초기화한다.
  useEffect(() => {
    if (open) return;
    setActiveCheckboxMode(false);
    setPendingEnableCheckbox(false);
    setSelectedActiveIds(new Set());
    setPendingBulkDelete(false);
  }, [open]);

  // DB Manager 열릴 때 보호 DB(작업·마일스톤·피처) 자동 시드 — 한번도 진입한 적 없는 워크스페이스 대응
  useEffect(() => {
    if (!open) return;
    const wsId = currentWorkspaceId ?? "";
    void Promise.all([
      ensureLCSchedulerDatabase(wsId),
      ensureLCMilestoneDatabase(wsId),
      ensureLCFeatureDatabase(wsId),
    ]).catch((err) => {
      console.warn("[db-manager] 보호 DB 시드 실패", err);
    });
  }, [open, currentWorkspaceId]);

  // 삭제된 DB 보기 진입 시 서버에서 휴지통 목록을 가져온다.
  useEffect(() => {
    if (!open || !showDeleted || !currentWorkspaceId) return;
    void fetchTrashedDatabases(currentWorkspaceId);
  }, [open, showDeleted, currentWorkspaceId, fetchTrashedDatabases]);

  const activeDbIds = useMemo(
    () => new Set(dbList.map((d) => d.id)),
    [dbList],
  );
  const q = query.trim().toLowerCase();
  // 보호 DB(작업·마일스톤·피처) 는 LC 워크스페이스 DB 관리 화면에서만 표시.
  // (인라인 DB 블록 연결 등 다른 경로에서는 어디서나 사용 가능)
  const inLCWorkspace = currentWorkspaceId === LC_SCHEDULER_WORKSPACE_ID;
  const referencedDatabaseIds = useMemo(() => {
    const ids = new Set<string>();
    for (const page of Object.values(pages)) {
      if (page.databaseId) ids.add(page.databaseId);
      if (page.fullPageDatabaseId) ids.add(page.fullPageDatabaseId);
      collectReferencedDatabaseIds(page.doc, ids);
    }
    return ids;
  }, [pages]);
  const visibleActive = dbList
    .filter((d) => {
      if (isProtectedDatabaseId(d.id) && !inLCWorkspace) return false;
      const bundle = databases[d.id];
      const templateCount = dbTemplates[d.id]?.length ?? 0;
      if (
        bundle &&
        !isProtectedDatabaseId(d.id) &&
        bundle.rowPageOrder.length === 0 &&
        templateCount === 0 &&
        !referencedDatabaseIds.has(d.id)
      ) {
        return false;
      }
      return koreanIncludes(d.meta.title.toLowerCase(), q);
    })
    .sort((a, b) => {
      const aScheduler = isLCSchedulerDatabaseId(a.id);
      const bScheduler = isLCSchedulerDatabaseId(b.id);
      if (aScheduler !== bScheduler) return aScheduler ? -1 : 1;
      return b.meta.updatedAt - a.meta.updatedAt;
    });
  const visibleDeleted = trashedDatabases
    .filter((d) => !activeDbIds.has(d.id))
    .filter((d) => !hiddenDeletedDbIds.has(d.id))
    .filter((d) => (d.title ?? "").toLowerCase().includes(q))
    .map((d) => ({
      databaseId: d.id,
      title: d.title || "제목 없음",
      workspaceId: d.workspaceId,
      ts: Date.parse(d.deletedAt ?? "") || 0,
    }));

  const removeDatabaseAndRowsFromLocalCache = (databaseId: string): void => {
    useDatabaseStore.setState((s) => {
      if (!s.databases[databaseId]) return s;
      const next = { ...s.databases };
      delete next[databaseId];
      return { ...s, databases: next };
    });
    usePageStore.setState((s) => {
      const rowPageIds = Object.values(s.pages)
        .filter((page) => page.databaseId === databaseId)
        .map((page) => page.id);
      if (rowPageIds.length === 0) return s;
      const rowPageIdSet = new Set(rowPageIds);
      const nextPages = { ...s.pages };
      for (const pageId of rowPageIds) delete nextPages[pageId];
      return {
        ...s,
        pages: nextPages,
        activePageId: s.activePageId && rowPageIdSet.has(s.activePageId) ? null : s.activePageId,
      };
    });
  };

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
      removeDatabaseAndRowsFromLocalCache(databaseId);
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
    if (ids.length === 0) return;

    // 각 DB 의 워크스페이스 매핑 — visibleDeleted 에 명시된 게 우선, fallback 으로 현재 WS.
    // workspaceId 가 끝까지 없는 항목은 사전 필터링하여 실패 카운트에서 제외.
    const targets = ids
      .map((databaseId) => {
        const workspaceId =
          visibleDeleted.find((d) => d.databaseId === databaseId)?.workspaceId
          ?? currentWorkspaceId
          ?? null;
        return workspaceId ? { id: databaseId, workspaceId } : null;
      })
      .filter((t): t is { id: string; workspaceId: string } => t !== null);
    if (targets.length === 0) return;

    setBulkPurgeProgress({ done: 0, total: targets.length });
    setPurgingIds(Object.fromEntries(targets.map(({ id }) => [id, true])));

    const { deletedCount, failedCount } = await runChunkedPermanentDelete(targets, {
      deleteRemote: permanentlyDeleteDatabaseRemote,
      onItemSuccess: ({ id, workspaceId }) => {
        markPermanentlyDeletedEntity("database", id, workspaceId);
        purgeDatabaseHistory(id);
        removeDatabaseAndRowsFromLocalCache(id);
        setHiddenDeletedDbIds((prev) => new Set(prev).add(id));
        setPurgingIds((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      },
      onItemFailure: ({ id }) => {
        setPurgingIds((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      },
      onProgress: (done, total) => setBulkPurgeProgress({ done, total }),
    });

    setSelectedDeletedIds(new Set());
    setBulkPurgeProgress(null);

    if (failedCount > 0) {
      showToast(`${deletedCount}개 영구삭제 / ${failedCount}개 실패`, {
        kind: failedCount === targets.length ? "error" : "info",
      });
    } else {
      showToast(`${deletedCount}개 데이터베이스를 영구삭제했습니다.`, { kind: "success" });
    }
  };

  // 체크된 활성 DB 를 일괄 삭제(휴지통으로 이동)한다. 보호 DB 는 store 에서 자동 제외.
  const confirmBulkDelete = () => {
    setPendingBulkDelete(false);
    const ids = Array.from(selectedActiveIds);
    if (ids.length === 0) return;
    let deleted = 0;
    for (const id of ids) {
      if (isProtectedDatabaseId(id)) continue;
      deleteDatabase(id);
      deleted += 1;
    }
    setSelectedActiveIds(new Set());
    setActiveCheckboxMode(false);
    showToast(`${deleted}개 데이터베이스를 삭제했습니다.`, { kind: "success" });
  };

  const openDatabase = (databaseId: string) => {
    setActivePage(null);
    setCurrentTabDatabase(databaseId);
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
            {/* 숨겨진 단축: DB 아이콘 더블클릭 → 체크박스 활성화 확인 팝업 */}
            <span
              onDoubleClick={() => setPendingEnableCheckbox(true)}
              className="inline-flex cursor-default select-none"
              title=""
            >
              <Database size={20} />
            </span>
            데이터베이스 관리
          </h2>
          <div className="flex items-center gap-2">
            {activeCheckboxMode && (
              <button
                type="button"
                onClick={() => setPendingBulkDelete(true)}
                disabled={selectedActiveIds.size === 0}
                className="rounded border border-red-300 px-2.5 py-1 text-sm text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/30"
              >
                {selectedActiveIds.size}개 모두 삭제
              </button>
            )}
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
              const rawFullPageTitle = fullPageId
                ? pages[fullPageId]?.title?.trim() || null
                : null;
              const fullPageTitle =
                rawFullPageTitle && rawFullPageTitle !== d.meta.title
                  ? rawFullPageTitle
                  : null;
              return (
              <div
                key={d.id}
                className="flex items-center justify-between gap-3 border-b border-zinc-100 px-3 py-2.5 text-lg last:border-b-0 dark:border-zinc-800"
              >
                {activeCheckboxMode && !isProtectedDatabaseId(d.id) && (
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 rounded"
                    checked={selectedActiveIds.has(d.id)}
                    onChange={(e) => {
                      setSelectedActiveIds((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(d.id);
                        else next.delete(d.id);
                        return next;
                      });
                    }}
                  />
                )}
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
                  {isProtectedDatabaseId(d.id) ? (
                    <span className="shrink-0 rounded bg-zinc-100 px-2 py-0.5 text-sm font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">
                      고정
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={() => openDatabase(d.id)}
                  className="shrink-0 rounded bg-blue-600 px-3 py-1.5 text-base text-white hover:bg-blue-700"
                >
                  열기
                </button>
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
                    disabled={bulkPurgeProgress != null}
                    className="rounded border border-red-300 px-2.5 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/30"
                  >
                    {bulkPurgeProgress
                      ? `${bulkPurgeProgress.done}/${bulkPurgeProgress.total}개 삭제중`
                      : `선택 영구삭제 (${selectedDeletedIds.size})`}
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
                    key={d.databaseId}
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
                        void restoreTrashedDatabase(d.databaseId, d.workspaceId).then((ok) => {
                          if (ok) showToast("데이터베이스를 복원했습니다.");
                        });
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
      {/* 숨겨진 단축: 체크박스 활성화 확인 */}
      <SimpleConfirmDialog
        open={pendingEnableCheckbox}
        title="DB 관리 체크박스"
        message="DB 관리를 위한 체크박스를 활성화하시겠습니까?"
        confirmLabel="활성화"
        cancelLabel="취소"
        zIndex={560}
        onCancel={() => setPendingEnableCheckbox(false)}
        onConfirm={() => {
          setActiveCheckboxMode(true);
          setSelectedActiveIds(new Set());
          setPendingEnableCheckbox(false);
        }}
      />
      {/* 숨겨진 단축: 활성 DB 일괄 삭제 확인 */}
      <SimpleConfirmDialog
        open={pendingBulkDelete}
        title="데이터베이스 삭제"
        message={`${selectedActiveIds.size}개의 DB를 모두 삭제하시겠습니까?`}
        confirmLabel="모두 삭제"
        cancelLabel="취소"
        danger
        zIndex={560}
        onCancel={() => setPendingBulkDelete(false)}
        onConfirm={() => confirmBulkDelete()}
      />
    </div>
  );
}
