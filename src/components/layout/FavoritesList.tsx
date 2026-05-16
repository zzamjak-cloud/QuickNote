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
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useUiStore } from "../../store/uiStore";
import { PageIconDisplay } from "../common/PageIconDisplay";
import { getRevokedFavoritePageIds } from "./favoritesAccess";

const FAVORITE_NAV_TIMEOUT_MS = 6000;

function FavoriteRow({ pageId }: { pageId: string }) {
  const page = usePageStore((s) => s.pages[pageId]);
  const setActivePage = usePageStore((s) => s.setActivePage);
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);
  const removeFavoritePage = useSettingsStore((s) => s.removeFavoritePage);
  const favoriteMeta = useSettingsStore((s) => s.favoritePageMetaById[pageId]);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const setCurrentWorkspaceId = useWorkspaceStore((s) => s.setCurrentWorkspaceId);
  const showToast = useUiStore((s) => s.showToast);
  const requestFavoriteNavigation = useUiStore((s) => s.requestFavoriteNavigation);

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
          const targetWorkspaceId = favoriteMeta?.workspaceId ?? null;
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
                `${favoriteMeta?.workspaceName || "해당 워크스페이스"}에 대한 접근 권한이 없습니다.`,
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
        }}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm text-zinc-800 dark:text-zinc-100"
      >
        <PageIconDisplay icon={page?.icon ?? favoriteMeta?.pageIcon ?? null} size="sm" />
        <span className="truncate">{page?.title || favoriteMeta?.pageTitle || "제목 없음"}</span>
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
    removeFavoritesForPages([pageId]);
    clearFavoriteNavigation();
    showToast("페이지를 찾을 수 없어 즐겨찾기에서 제거했습니다.", { kind: "error" });
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
