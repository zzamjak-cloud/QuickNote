// 개인 즐겨찾기 목록 — DnD 정렬

import { useCallback, useEffect, useMemo } from "react";
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
import { PageIconDisplay } from "../common/PageIconDisplay";

function FavoriteRow({ pageId }: { pageId: string }) {
  const page = usePageStore((s) => s.pages[pageId]);
  const setActivePage = usePageStore((s) => s.setActivePage);
  const removeFavoritePage = useSettingsStore((s) => s.removeFavoritePage);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: pageId });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  if (!page) return null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group flex min-h-7 items-center gap-1 rounded-md px-0.5 py-0.5 hover:bg-zinc-200/80 dark:hover:bg-zinc-800/80"
    >
      <button
        type="button"
        className="shrink-0 cursor-grab touch-none rounded p-0.5 text-zinc-400 hover:bg-zinc-200 active:cursor-grabbing dark:hover:bg-zinc-700"
        aria-label="순서 변경"
        {...attributes}
        {...listeners}
      >
        <span className="block w-3 text-center text-[10px] leading-none">⋮⋮</span>
      </button>
      <button
        type="button"
        onClick={() => setActivePage(pageId)}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs text-zinc-800 dark:text-zinc-100"
      >
        <PageIconDisplay icon={page.icon} size="sm" />
        <span className="truncate">{page.title || "제목 없음"}</span>
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
  const reorderFavorites = useSettingsStore((s) => s.reorderFavorites);
  const removeFavoritesForPages = useSettingsStore(
    (s) => s.removeFavoritesForPages,
  );
  const pages = usePageStore((s) => s.pages);

  const validIds = useMemo(
    () => favoritePageIds.filter((id) => pages[id]),
    [favoritePageIds, pages],
  );

  // 삭제 등으로 사라진 페이지 id 는 즐겨찾기 배열에서 제거
  useEffect(() => {
    const orphan = favoritePageIds.filter((id) => !pages[id]);
    if (orphan.length > 0) removeFavoritesForPages(orphan);
  }, [favoritePageIds, pages, removeFavoritesForPages]);

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
      <p className="px-1 text-[11px] text-zinc-400">즐겨찾기한 페이지가 없습니다.</p>
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
