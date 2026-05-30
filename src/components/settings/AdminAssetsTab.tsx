// 자산 관리 탭 — 사용자가 업로드한 모든 자산을 시각적으로 확인·삭제하는 UI.
// 정렬(크기 desc 기본) + MIME/사용여부 필터 + 가상 스크롤 표 + 다중 선택 영구 삭제 +
// 사용 위치(페이지) 인라인 표시.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Search, Trash2, RefreshCw, Filter, ExternalLink, Pencil } from "lucide-react";
import { ListVirtualizer } from "../../lib/ui-primitives/ListVirtualizer";
import { SimpleConfirmDialog } from "../ui/SimpleConfirmDialog";
import {
  listMyAssetsApi,
  deleteMyAssetsApi,
  getAssetUsagesApi,
  migrateAssetUsageApi,
  renameAssetApi,
  type ListMyAssetsInput,
} from "../../lib/sync/assetApi";
import type { GqlAsset, GqlAssetUsage } from "../../lib/sync/graphql/operations";
import { usePageStore } from "../../store/pageStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useCustomIconStore } from "../../store/customIconStore";
import { collectCustomIconAssetIds } from "../../lib/assets/customIconAssetProtection";
import { imageUrlCache } from "../../lib/images/registry";

type SortKey = "SIZE_DESC" | "SIZE_ASC" | "CREATED_AT_DESC";

const ROW_HEIGHT = 56;

function formatBytes(n: number): string {
  if (!n || n <= 0) return "0";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const e = err as { message?: string; errors?: Array<{ message?: string }> };
    if (typeof e.message === "string" && e.message) return e.message;
    if (Array.isArray(e.errors) && e.errors.length > 0) {
      return e.errors.map((x) => x?.message ?? "").filter(Boolean).join(" / ") || JSON.stringify(err);
    }
    try {
      return JSON.stringify(err).slice(0, 300);
    } catch {
      return "알 수 없는 오류";
    }
  }
  return String(err);
}

function mimeChip(mime: string): string {
  if (mime.startsWith("image/")) return mime.replace("image/", "img/");
  if (mime.startsWith("video/")) return mime.replace("video/", "vid/");
  if (mime.startsWith("audio/")) return mime.replace("audio/", "aud/");
  return mime;
}

function dedupeAssetsById(items: GqlAsset[]): GqlAsset[] {
  const seen = new Set<string>();
  const out: GqlAsset[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

export function AdminAssetsTab(props: { onClose?: () => void }) {
  const [assets, setAssets] = useState<GqlAsset[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState<string>("");
  const [sortBy, setSortBy] = useState<SortKey>("SIZE_DESC");
  const [mimeFilter, setMimeFilter] = useState<"" | "image" | "video" | "audio" | "other">("");
  const [unusedOnly, setUnusedOnly] = useState<boolean>(false);
  const [minSizeMb, setMinSizeMb] = useState<number>(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<boolean>(false);
  const [deleteProgress, setDeleteProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const [usageOpenFor, setUsageOpenFor] = useState<GqlAsset | null>(null);
  const [usageRows, setUsageRows] = useState<GqlAssetUsage[]>([]);
  const [usageLoading, setUsageLoading] = useState<boolean>(false);
  const [migrating, setMigrating] = useState<boolean>(false);
  const [migrateNotice, setMigrateNotice] = useState<string | null>(null);
  // 미리보기 대상 자산 — 행 클릭으로 모달 오픈.
  const [previewAsset, setPreviewAsset] = useState<GqlAsset | null>(null);

  const pages = usePageStore((s) => s.pages);
  const setActivePage = usePageStore((s) => s.setActivePage);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const setCurrentWorkspaceId = useWorkspaceStore((s) => s.setCurrentWorkspaceId);
  const customIconsByWorkspace = useCustomIconStore((s) => s.byWorkspace);
  const fetchCustomIcons = useCustomIconStore((s) => s.fetch);

  const customIconAssetIds = useMemo(() => {
    if (!currentWorkspaceId) return new Set<string>();
    return collectCustomIconAssetIds(customIconsByWorkspace[currentWorkspaceId] ?? []);
  }, [currentWorkspaceId, customIconsByWorkspace]);

  useEffect(() => {
    if (!currentWorkspaceId) return;
    void fetchCustomIcons(currentWorkspaceId);
  }, [currentWorkspaceId, fetchCustomIcons]);

  const fetchAssets = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setError(null);
    try {
      const input: ListMyAssetsInput = {
        sortBy,
        ...(mimeFilter && mimeFilter !== "other" ? { filterMimePrefix: `${mimeFilter}/` } : {}),
        ...(unusedOnly ? { filterUnusedOnly: true } : {}),
        ...(minSizeMb > 0 ? { minSize: minSizeMb * 1024 * 1024 } : {}),
        limit: 500,
      };
      const res = await listMyAssetsApi(input);
      setAssets(dedupeAssetsById(res.items));
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  }, [sortBy, mimeFilter, unusedOnly, minSizeMb]);

  useEffect(() => {
    void fetchAssets();
  }, [fetchAssets]);

  // 'other' (image/video/audio 외) 클라이언트 측 필터.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assets.filter((a) => {
      if (unusedOnly && customIconAssetIds.has(a.id)) return false;
      if (mimeFilter === "other") {
        if (a.mimeType.startsWith("image/") || a.mimeType.startsWith("video/") || a.mimeType.startsWith("audio/")) return false;
      }
      if (q) {
        const hay = `${a.name ?? ""} ${a.mimeType} ${a.id}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [assets, customIconAssetIds, mimeFilter, search, unusedOnly]);

  const totalBytes = useMemo(() => assets.reduce((sum, a) => sum + (a.size || 0), 0), [assets]);
  const selectedBytes = useMemo(() => {
    let s = 0;
    for (const a of filtered) if (selected.has(a.id)) s += a.size || 0;
    return s;
  }, [filtered, selected]);

  const selectableFiltered = useMemo(
    () => filtered.filter((a) => !customIconAssetIds.has(a.id)),
    [customIconAssetIds, filtered],
  );
  const allSelectableInViewSelected =
    selectableFiltered.length > 0 &&
    selectableFiltered.every((a) => selected.has(a.id));
  const someSelectableInViewSelected = selectableFiltered.some((a) => selected.has(a.id));

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelectableInViewSelected) {
        for (const a of selectableFiltered) next.delete(a.id);
      } else {
        for (const a of selectableFiltered) next.add(a.id);
      }
      return next;
    });
  }, [allSelectableInViewSelected, selectableFiltered]);

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const runDelete = useCallback(async () => {
    const protectedCount = Array.from(selected).filter((id) =>
      customIconAssetIds.has(id),
    ).length;
    const ids = Array.from(selected).filter((id) => !customIconAssetIds.has(id));
    if (protectedCount > 0) {
      setError(
        `커스텀 아이콘으로 등록된 자산 ${protectedCount}개는 아이콘 삭제 후 제거할 수 있습니다.`,
      );
    }
    if (ids.length === 0) {
      setConfirmOpen(false);
      return;
    }
    setDeleting(true);
    if (protectedCount === 0) setError(null);
    setConfirmOpen(false);
    setDeleteProgress({ done: 0, total: ids.length });
    // Lambda 호출당 처리량 제한(타임아웃·동시성) 회피 — 청크로 분할 호출하고 실패는 부분 성공으로 누적.
    const CHUNK = 30;
    const failures: string[] = [];
    let totalDeleted = 0;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      try {
        const deleted = await deleteMyAssetsApi(chunk);
        const deletedSet = new Set(deleted);
        totalDeleted += deleted.length;
        for (const id of deleted) imageUrlCache.invalidate(id);
        setAssets((prev) => prev.filter((a) => !deletedSet.has(a.id)));
        setSelected((prev) => {
          const next = new Set(prev);
          for (const id of deleted) next.delete(id);
          return next;
        });
      } catch (err) {
        failures.push(formatError(err));
        console.error("[deleteMyAssets chunk 실패]", err);
      }
      setDeleteProgress({ done: Math.min(i + chunk.length, ids.length), total: ids.length });
    }
    if (failures.length > 0) {
      setError(`${totalDeleted}/${ids.length}개 삭제됨. 실패: ${failures[0]}`);
    }
    setDeleting(false);
    setDeleteProgress(null);
  }, [customIconAssetIds, selected]);

  const renameAsset = useCallback(async (asset: GqlAsset) => {
    const current = asset.name ?? "";
    const next = window.prompt("새 자산 이름 (비우면 이름 제거)", current);
    if (next === null) return; // 취소
    const trimmed = next.trim();
    if (trimmed === current) return; // 변경 없음
    try {
      const updated = await renameAssetApi(asset.id, trimmed.length > 0 ? trimmed : null);
      if (!updated) return;
      setAssets((prev) =>
        prev.map((a) => (a.id === asset.id ? { ...a, name: updated.name } : a)),
      );
    } catch (err) {
      setError(`이름 변경 실패: ${formatError(err)}`);
    }
  }, []);

  const openUsage = useCallback(async (asset: GqlAsset) => {
    setUsageOpenFor(asset);
    setUsageRows([]);
    setUsageLoading(true);
    try {
      const rows = await getAssetUsagesApi(asset.id);
      setUsageRows(rows);
    } catch (err) {
      console.error("[assets] usage fetch 실패", err);
    } finally {
      setUsageLoading(false);
    }
  }, []);

  const runMigrate = useCallback(async () => {
    setMigrating(true);
    setMigrateNotice("인덱싱 시작…");
    let totalRows = 0;
    let cursor: string | null = null;
    let pass = 0;
    try {
      // Lambda 단일 호출 시간 한도(28s) 이내에서 시간-박스로 처리하고 cursor 로 이어 호출.
      // hasMore=false 가 될 때까지 반복.
      while (true) {
        pass += 1;
        const res = await migrateAssetUsageApi(cursor);
        totalRows += res.processedRows;
        setMigrateNotice(`인덱싱 진행 중 — ${totalRows}건 (${pass}회차)`);
        if (!res.hasMore || !res.nextCursor) break;
        cursor = res.nextCursor;
        // 안전 가드 — 무한 루프 방지 (정상이라면 hasMore 가 곧 false).
        if (pass > 200) {
          setMigrateNotice(`중단 — pass 한도 초과 (현재까지 ${totalRows}건)`);
          break;
        }
      }
      setMigrateNotice(`인덱싱 완료 — 총 ${totalRows}건의 참조 (${pass}회차)`);
      await fetchAssets({ silent: true });
    } catch (err) {
      setMigrateNotice(`실패 (${totalRows}건까지 처리됨): ${formatError(err)}`);
    } finally {
      setMigrating(false);
    }
  }, [fetchAssets]);

  return (
    <div className="flex h-full flex-col gap-3">
      {/* 헤더 — 검색·필터·액션 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름·MIME·ID"
            className="h-8 w-56 rounded border border-zinc-200 bg-white pl-7 pr-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortKey)}
          className="h-8 rounded border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="SIZE_DESC">크기 큰 순</option>
          <option value="SIZE_ASC">크기 작은 순</option>
          <option value="CREATED_AT_DESC">최근 업로드 순</option>
        </select>
        <select
          value={mimeFilter}
          onChange={(e) => setMimeFilter(e.target.value as typeof mimeFilter)}
          className="h-8 rounded border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="">모든 종류</option>
          <option value="image">이미지</option>
          <option value="video">동영상</option>
          <option value="audio">오디오</option>
          <option value="other">기타</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-200">
          <input
            type="checkbox"
            checked={unusedOnly}
            onChange={(e) => setUnusedOnly(e.target.checked)}
            className="size-4"
          />
          사용 안 됨만
        </label>
        <label className="flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-200">
          <Filter size={12} className="text-zinc-400" />
          ≥
          <input
            type="number"
            min={0}
            value={minSizeMb}
            onChange={(e) => setMinSizeMb(Math.max(0, parseInt(e.target.value, 10) || 0))}
            className="h-7 w-14 rounded border border-zinc-200 bg-white px-1.5 text-right text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          MB
        </label>
        <button
          type="button"
          onClick={() => void fetchAssets()}
          className="ml-auto flex h-8 items-center gap-1 rounded border border-zinc-200 bg-white px-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          aria-label="새로고침"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          새로고침
        </button>
        <button
          type="button"
          onClick={() => void runMigrate()}
          disabled={migrating}
          className="flex h-8 items-center gap-1 rounded border border-zinc-200 bg-white px-2 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          title="기존 페이지를 스캔해 자산 사용 인덱스를 재구성 (한 번만 실행)"
        >
          {migrating ? <Loader2 size={14} className="animate-spin" /> : null}
          인덱스 재구성
        </button>
      </div>

      {/* 통계 + bulk action */}
      <div className="flex items-center justify-between rounded border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
        <div>
          {filtered.length} / {assets.length}개 · 합계 {formatBytes(totalBytes)}
          {selected.size > 0 ? (
            <span className="ml-3 font-medium text-rose-600 dark:text-rose-400">
              선택 {selected.size}개 · {formatBytes(selectedBytes)}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={selected.size === 0 || deleting}
            className="flex items-center gap-1 rounded bg-rose-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-40"
          >
            {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
            {deleteProgress
              ? `삭제 중 ${deleteProgress.done}/${deleteProgress.total}`
              : "선택 영구 삭제"}
          </button>
        </div>
      </div>

      {migrateNotice ? (
        <div className="rounded border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300">
          {migrateNotice}
        </div>
      ) : null}
      {error ? (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      {/* 표 헤더 */}
      <div className="flex items-center gap-2 border-b border-zinc-200 px-2 py-1 text-xs font-medium text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        <input
          type="checkbox"
          checked={allSelectableInViewSelected}
          ref={(el) => {
            if (el) {
              el.indeterminate =
                !allSelectableInViewSelected && someSelectableInViewSelected;
            }
          }}
          onChange={toggleAll}
          disabled={selectableFiltered.length === 0}
          className="size-4"
        />
        <div className="w-12 text-center">미리보기</div>
        <div className="min-w-0 flex-1">이름</div>
        <div className="w-20">MIME</div>
        <div className="w-20 text-right">크기</div>
        <div className="w-24 text-right">사용 페이지</div>
        <div className="w-32 text-right">업로드</div>
      </div>

      {/* 가상 스크롤 표 */}
      <div className="min-h-0 flex-1">
        {loading && assets.length === 0 ? (
          <div className="flex h-full items-center justify-center text-zinc-500">
            <Loader2 className="animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">
            조건에 맞는 자산이 없습니다.
          </div>
        ) : (
          <ListVirtualizer
            count={filtered.length}
            estimateSize={() => ROW_HEIGHT}
            overscan={8}
            className="h-full overflow-y-auto"
          >
            {({ index, style }) => {
              const a = filtered[index]!;
              const isSel = selected.has(a.id);
              const customIconProtected = customIconAssetIds.has(a.id);
              const serverUsedCount = a.usageCount ?? 0;
              const usedCount = Math.max(serverUsedCount, customIconProtected ? 1 : 0);
              return (
                <div
                  style={style}
                  className={`flex cursor-pointer items-center gap-2 border-b border-zinc-100 px-2 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/40 ${
                    isSel ? "bg-zinc-50 dark:bg-zinc-800/60" : ""
                  }`}
                  onClick={(e) => {
                    // 행 내부의 버튼/인풋 클릭은 자기 동작만 수행하고 미리보기를 열지 않는다.
                    const target = e.target as HTMLElement;
                    if (target.closest("button, input, a")) return;
                    setPreviewAsset(a);
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
                      e.preventDefault();
                      setPreviewAsset(a);
                    }
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isSel}
                    disabled={customIconProtected}
                    title={customIconProtected ? "커스텀 아이콘 등록 자산" : undefined}
                    onChange={() => toggleOne(a.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="size-4 disabled:cursor-not-allowed disabled:opacity-40"
                  />
                  <AssetThumb asset={a} />
                  <div
                    className="group flex min-w-0 flex-1 items-center gap-1 text-zinc-800 dark:text-zinc-200"
                    title={a.name ?? a.id}
                  >
                    <span className="min-w-0 truncate">
                      {a.name ?? <span className="text-zinc-500">{a.id.slice(0, 12)}…</span>}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void renameAsset(a);
                      }}
                      className="shrink-0 rounded p-0.5 text-zinc-400 opacity-0 hover:bg-zinc-100 hover:text-blue-600 group-hover:opacity-100 dark:hover:bg-zinc-700"
                      title="이름 변경"
                      aria-label="이름 변경"
                    >
                      <Pencil size={11} />
                    </button>
                  </div>
                  <div className="w-20 truncate text-xs text-zinc-500" title={a.mimeType}>
                    {mimeChip(a.mimeType)}
                  </div>
                  <div className="w-20 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                    {formatBytes(a.size)}
                  </div>
                  {customIconProtected && serverUsedCount === 0 ? (
                    <div className="w-24 text-right text-xs text-emerald-600 dark:text-emerald-400">
                      커스텀 아이콘
                    </div>
                  ) : usedCount === 0 ? (
                    <div className="w-24 text-right text-xs text-zinc-300">사용 안 됨</div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void openUsage(a)}
                      className="flex w-24 items-center justify-end gap-1 rounded px-1 text-right text-xs text-blue-600 hover:underline dark:text-blue-400"
                      title="사용 중인 페이지 보기 (클릭 시 페이지로 바로가기)"
                    >
                      <span className="tabular-nums">{usedCount}개</span>
                      <ExternalLink size={11} />
                    </button>
                  )}
                  <div className="w-32 text-right text-xs text-zinc-400 tabular-nums">
                    {a.createdAt.slice(0, 10)}
                  </div>
                </div>
              );
            }}
          </ListVirtualizer>
        )}
      </div>

      {/* 영구 삭제 확인 */}
      <SimpleConfirmDialog
        open={confirmOpen}
        title="자산 영구 삭제"
        message={`선택한 ${selected.size}개 자산을 영구 삭제합니다.\n총 ${formatBytes(selectedBytes)} 회수.\n페이지에서 참조 중인 자산은 깨진 링크로 남을 수 있으므로 신중히 진행하세요.`}
        confirmLabel="영구 삭제"
        danger
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void runDelete()}
      />

      {/* 미리보기 모달 */}
      {previewAsset ? (
        <AssetPreviewDialog asset={previewAsset} onClose={() => setPreviewAsset(null)} />
      ) : null}

      {/* 사용 위치 모달 */}
      {usageOpenFor ? (
        <UsageDialog
          asset={usageOpenFor}
          rows={usageRows}
          loading={usageLoading}
          pages={pages}
          onClose={() => setUsageOpenFor(null)}
          onNavigate={(pageId, workspaceId) => {
            // 자산이 다른 워크스페이스의 페이지에서 쓰이는 경우, 먼저 워크스페이스 전환.
            if (workspaceId && workspaceId !== currentWorkspaceId) {
              setCurrentWorkspaceId(workspaceId);
            }
            setActivePage(pageId);
            setUsageOpenFor(null);
            // 설정 모달도 함께 닫아 페이지가 즉시 보이도록.
            props.onClose?.();
          }}
        />
      ) : null}
    </div>
  );
}

function AssetPreviewDialog({ asset, onClose }: { asset: GqlAsset; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setErr(null);
    const cached = imageUrlCache.peek(asset.id);
    if (cached) {
      setUrl(cached);
    } else {
      void imageUrlCache.get(asset.id).then(
        (u) => { if (!cancelled) setUrl(u); },
        (e) => { if (!cancelled) setErr(formatError(e)); },
      );
    }
    return () => { cancelled = true; };
  }, [asset.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isImage = asset.mimeType.startsWith("image/");
  const isVideo = asset.mimeType.startsWith("video/");
  const isAudio = asset.mimeType.startsWith("audio/");
  const isPdf = asset.mimeType === "application/pdf";

  return (
    <div
      className="fixed inset-0 z-[560] flex items-center justify-center bg-black/70 p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-lg bg-white shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {asset.name ?? asset.id}
            </div>
            <div className="text-xs text-zinc-500">
              {asset.mimeType} · {formatBytes(asset.size)} · {asset.createdAt.slice(0, 10)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                download={asset.name ?? undefined}
                className="rounded border border-zinc-200 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                다운로드
              </a>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              닫기
            </button>
          </div>
        </div>
        <div className="grid min-h-0 flex-1 place-items-center overflow-auto bg-zinc-50 p-4 dark:bg-zinc-950">
          {err ? (
            <div className="text-sm text-rose-600 dark:text-rose-400">불러오기 실패: {err}</div>
          ) : !url ? (
            <Loader2 className="animate-spin text-zinc-400" />
          ) : isImage ? (
            <img src={url} alt={asset.name ?? ""} className="max-h-[70vh] max-w-full object-contain" />
          ) : isVideo ? (
            // autoPlay 와 default preload(auto) 는 20MB 이상에서 첫 프레임까지 수십 초 소요.
            // metadata 만 먼저 받아 즉시 컨트롤 노출, 재생은 사용자 클릭으로 시작.
            <video
              src={url}
              className="max-h-[70vh] max-w-full"
              controls
              playsInline
              preload="metadata"
            />
          ) : isAudio ? (
            <audio src={url} controls className="w-full max-w-md" />
          ) : isPdf ? (
            <iframe src={url} className="h-[70vh] w-full" title={asset.name ?? "PDF"} />
          ) : (
            <div className="flex flex-col items-center gap-2 text-sm text-zinc-500">
              <div>이 형식은 인라인 미리보기를 지원하지 않습니다.</div>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded bg-blue-600 px-3 py-1 text-white hover:bg-blue-700"
              >
                새 탭에서 열기
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AssetThumb({ asset }: { asset: GqlAsset }) {
  const [url, setUrl] = useState<string | null>(null);
  const isImage = asset.mimeType.startsWith("image/");
  const isVideo = asset.mimeType.startsWith("video/");
  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    if (!isImage && !isVideo) return;
    const cached = imageUrlCache.peek(asset.id);
    if (cached) {
      setUrl(cached);
      return;
    }
    void imageUrlCache.get(asset.id).then(
      (u) => {
        if (!cancelled) setUrl(u);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [asset.id, isImage, isVideo]);
  return (
    <div className="grid h-10 w-12 place-items-center overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800">
      {url && isImage ? (
        <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : url && isVideo ? (
        // 첫 프레임 미리보기 — preload="metadata" 로 메타데이터만 로드 (대역폭 절약).
        // muted + playsInline 으로 자동 첫 프레임 캡처. #t=0.1 으로 일부 브라우저에서 첫 프레임 강제 로드.
        <video
          src={`${url}#t=0.1`}
          className="h-full w-full object-cover"
          preload="metadata"
          muted
          playsInline
        />
      ) : (
        <span className="text-[10px] uppercase text-zinc-400">{asset.mimeType.split("/")[0]}</span>
      )}
    </div>
  );
}

function UsageDialog(props: {
  asset: GqlAsset;
  rows: GqlAssetUsage[];
  loading: boolean;
  pages: Record<string, { id: string; title: string } | undefined>;
  onClose: () => void;
  onNavigate: (pageId: string, workspaceId: string | null) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[540] flex items-center justify-center bg-black/40 p-6"
      onClick={props.onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg bg-white shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {props.asset.name ?? props.asset.id}
            </div>
            <div className="text-xs text-zinc-500">사용 위치 {props.rows.length}개</div>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            닫기
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {props.loading ? (
            <div className="flex h-24 items-center justify-center text-zinc-500">
              <Loader2 className="animate-spin" />
            </div>
          ) : props.rows.length === 0 ? (
            <div className="p-4 text-center text-sm text-zinc-500">
              이 자산을 참조하는 페이지가 없습니다.
            </div>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {props.rows.map((r) => {
                const isCustomIconUsage =
                  r.blockType === "customIcon" ||
                  r.pageId.startsWith("__customIcon__:");
                const page = props.pages[r.pageId];
                const title = isCustomIconUsage
                  ? "커스텀 아이콘 라이브러리"
                  : page?.title || r.pageTitle || "(제목 없음)";
                return (
                  <li key={`${r.assetId}-${r.pageId}-${r.blockId ?? ""}`}>
                    <button
                      type="button"
                      onClick={() => {
                        if (!isCustomIconUsage) props.onNavigate(r.pageId, r.workspaceId);
                      }}
                      disabled={isCustomIconUsage}
                      className={[
                        "group flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm",
                        isCustomIconUsage
                          ? "cursor-default"
                          : "hover:bg-blue-50 dark:hover:bg-blue-950/30",
                      ].join(" ")}
                      title={isCustomIconUsage ? "커스텀 아이콘 등록 자산" : "이 페이지로 바로가기"}
                    >
                      <span
                        className={[
                          "min-w-0 flex-1 truncate text-zinc-800 dark:text-zinc-200",
                          isCustomIconUsage
                            ? ""
                            : "group-hover:text-blue-700 dark:group-hover:text-blue-300",
                        ].join(" ")}
                      >
                        {title}
                      </span>
                      <span className="shrink-0 text-xs text-zinc-400">
                        {r.blockType ?? ""}
                      </span>
                      {isCustomIconUsage ? null : (
                        <ExternalLink size={12} className="shrink-0 text-zinc-400 group-hover:text-blue-600 dark:group-hover:text-blue-400" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
