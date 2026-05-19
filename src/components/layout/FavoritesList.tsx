// 개인 즐겨찾기 목록 — DnD 정렬

import { useCallback, useEffect } from "react";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { StarOff } from "lucide-react";
import { usePageStore } from "../../store/pageStore";
import { useSettingsStore } from "../../store/settingsStore";
import type { FavoritePageMeta } from "../../store/settingsStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import type { WorkspaceSummary } from "../../store/workspaceStore";
import { useUiStore } from "../../store/uiStore";
import { fetchPagesByWorkspace } from "../../lib/sync";
import {
  getFavoritePageMetaFromLoadedWorkspaceSnapshots,
  resolveFavoritePageMetaFromWorkspaceSnapshots,
} from "../../lib/sync/workspaceSwitch";
import { PageIconDisplay } from "../common/PageIconDisplay";
import { getRevokedFavoritePageIds } from "./favoritesAccess";

const FAVORITE_NAV_TIMEOUT_MS = 6000;

async function resolveFavoritePageMeta(
  pageId: string,
  workspaces: readonly WorkspaceSummary[],
): Promise<FavoritePageMeta | null> {
  const cached = await resolveFavoritePageMetaFromWorkspaceSnapshots(pageId, workspaces);
  if (cached) return cached;

  for (const workspace of workspaces) {
    try {
      const pages = await fetchPagesByWorkspace(workspace.workspaceId);
      const page = pages.find((candidate) => candidate.id === pageId && !candidate.deletedAt);
      if (!page) continue;
      return {
        pageId,
        workspaceId: workspace.workspaceId,
        workspaceName: workspace.name,
        pageTitle: page.title || "제목 없음",
        pageIcon: page.icon ?? null,
      };
    } catch {
      // 접근 권한이 없는 워크스페이스는 다음 후보를 확인한다.
    }
  }
  return null;
}

function FavoriteRow({ pageId }: { pageId: string }) {
  const page = usePageStore((s) => s.pages[pageId]);
  const setActivePage = usePageStore((s) => s.setActivePage);
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);
  const removeFavoritePage = useSettingsStore((s) => s.removeFavoritePage);
  const updateFavoritePageMeta = useSettingsStore((s) => s.updateFavoritePageMeta);
  const favoriteMeta = useSettingsStore((s) => s.favoritePageMetaById[pageId]);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const setCurrentWorkspaceId = useWorkspaceStore((s) => s.setCurrentWorkspaceId);
  const showToast = useUiStore((s) => s.showToast);
  const requestFavoriteNavigation = useUiStore((s) => s.requestFavoriteNavigation);
  const snapshotMeta =
    favoriteMeta ??
    getFavoritePageMetaFromLoadedWorkspaceSnapshots(pageId, workspaces);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: pageId });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group flex min-h-7 items-center gap-1 rounded-md px-1 py-0.5 hover:bg-zinc-200/80 dark:hover:bg-zinc-800/80"
      {...attributes}
      {...listeners}
    >
      <button
        type="button"
        onClick={() => {
          void (async () => {
            let targetMeta = snapshotMeta;
            if (!targetMeta && !page) {
              targetMeta = await resolveFavoritePageMeta(pageId, workspaces);
              if (targetMeta) {
                updateFavoritePageMeta(pageId, targetMeta);
              }
            }
            const targetWorkspaceId = targetMeta?.workspaceId ?? null;
            if (targetWorkspaceId) {
              const workspace = workspaces.find(
                (w) => w.workspaceId === targetWorkspaceId,
              );
              if (!workspace) {
                if (workspaces.length === 0) {
                  requestFavoriteNavigation({
                    pageId,
                    workspaceId: targetWorkspaceId,
                  });
                  return;
                }
                removeFavoritePage(pageId);
                showToast(
                  `${targetMeta?.workspaceName || "해당 워크스페이스"}에 대한 접근 권한이 없습니다.`,
                  { kind: "error" },
                );
                return;
              }
              if (currentWorkspaceId !== targetWorkspaceId) {
                setCurrentWorkspaceId(targetWorkspaceId);
                requestFavoriteNavigation({
                  pageId,
                  workspaceId: targetWorkspaceId,
                });
                return;
              }
            }
            if (!page) {
              requestFavoriteNavigation({
                pageId,
                workspaceId: targetWorkspaceId,
              });
              return;
            }
            setCurrentTabPage(pageId);
            setActivePage(pageId);
          })();
        }}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm text-zinc-800 dark:text-zinc-100"
      >
        <PageIconDisplay icon={page?.icon ?? snapshotMeta?.pageIcon ?? null} size="sm" />
        <span className="truncate">{page?.title || snapshotMeta?.pageTitle || "제목 확인 중"}</span>
      </button>
      <button
        type="button"
        onClick={() => removeFavoritePage(pageId)}
        className="shrink-0 rounded p-0.5 text-zinc-400 opacity-0 hover:bg-zinc-200 hover:text-amber-600 group-hover:opacity-100 dark:hover:bg-zinc-700"
        aria-label="즐겨찾기 해제"
        title="즐겨찾기 해제"
      >
        <StarOff size={14} />
      </button>
    </div>
  );
}

export function FavoritesList() {
  const favoritePageIds = useSettingsStore((s) => s.favoritePageIds);
  const favoritePageMetaById = useSettingsStore((s) => s.favoritePageMetaById);
  const reorderFavorites = useSettingsStore((s) => s.reorderFavorites);
  const updateFavoritePageMeta = useSettingsStore((s) => s.updateFavoritePageMeta);
  const removeFavoritesForPages = useSettingsStore(
    (s) => s.removeFavoritesForPages,
  );
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);
  const pages = usePageStore((s) => s.pages);
  const setActivePage = usePageStore((s) => s.setActivePage);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const showToast = useUiStore((s) => s.showToast);
  const pendingFavoriteNavigation = useUiStore((s) => s.pendingFavoriteNavigation);
  const clearFavoriteNavigation = useUiStore((s) => s.clearFavoriteNavigation);
  const workspaces = useWorkspaceStore((s) => s.workspaces);

  useEffect(() => {
    if (favoritePageIds.length === 0 || workspaces.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const pageId of favoritePageIds) {
        if (cancelled) return;
        const page = pages[pageId];
        if (page) {
          const workspace =
            workspaces.find((w) => w.workspaceId === currentWorkspaceId) ??
            null;
          updateFavoritePageMeta(pageId, {
            pageId,
            workspaceId: currentWorkspaceId,
            workspaceName: workspace?.name ?? "",
            pageTitle: page.title || "제목 없음",
            pageIcon: page.icon ?? null,
          });
          continue;
        }
        if (favoritePageMetaById[pageId]?.workspaceId) continue;
        const meta = await resolveFavoritePageMeta(pageId, workspaces);
        if (!cancelled && meta) updateFavoritePageMeta(pageId, meta);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    currentWorkspaceId,
    favoritePageIds,
    favoritePageMetaById,
    pages,
    updateFavoritePageMeta,
    workspaces,
  ]);

  const validIds = favoritePageIds;

  // 접근 권한이 사라진 워크스페이스의 즐겨찾기는 자동 제거
  useEffect(() => {
    if (favoritePageIds.length === 0) return;
    const revoked = getRevokedFavoritePageIds(
      favoritePageIds,
      favoritePageMetaById,
      workspaces,
    );
    if (revoked.length > 0) removeFavoritesForPages(revoked);
  }, [favoritePageIds, favoritePageMetaById, workspaces, removeFavoritesForPages]);

  useEffect(() => {
    if (!pendingFavoriteNavigation) return;
    const { pageId, workspaceId, requestedAt } = pendingFavoriteNavigation;
    if (workspaceId && currentWorkspaceId !== workspaceId) return;
    if (pages[pageId]) {
      setCurrentTabPage(pageId);
      setActivePage(pageId);
      clearFavoriteNavigation();
      return;
    }
    if (Date.now() - requestedAt < FAVORITE_NAV_TIMEOUT_MS) return;
    clearFavoriteNavigation();
    if (workspaceId) {
      removeFavoritesForPages([pageId]);
      showToast("페이지를 찾을 수 없어 즐겨찾기에서 제거했습니다.", { kind: "error" });
    } else {
      showToast("페이지 위치를 아직 확인하지 못했습니다.", { kind: "error" });
    }
  }, [
    pendingFavoriteNavigation,
    currentWorkspaceId,
    pages,
    setCurrentTabPage,
    setActivePage,
    clearFavoriteNavigation,
    removeFavoritesForPages,
    showToast,
  ]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const a = String(active.id);
      const o = String(over.id);
      const oldIndex = validIds.indexOf(a);
      const newIndex = validIds.indexOf(o);
      if (oldIndex < 0 || newIndex < 0) return;
      reorderFavorites(arrayMove(validIds, oldIndex, newIndex));
    },
    [reorderFavorites, validIds],
  );

  if (validIds.length === 0) {
    return (
      <p className="px-1 text-sm text-zinc-400">즐겨찾기한 페이지가 없습니다.</p>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={validIds} strategy={verticalListSortingStrategy}>
        {validIds.map((id) => (
          <FavoriteRow key={id} pageId={id} />
        ))}
      </SortableContext>
    </DndContext>
  );
}
