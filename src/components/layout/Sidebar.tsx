import { useEffect, useRef, useState } from "react";

import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
  type DragMoveEvent,
} from "@dnd-kit/core";
import { Plus, Search } from "lucide-react";
import {
  usePageStore,
  filterPageTree,
} from "../../store/pageStore";
import { PageListGroup } from "./PageListGroup";
import { PageMoveDialog } from "./PageMoveDialog";

/** 드롭 행의 오른쪽 ~55% 구간에 포인터가 있으면 자식으로 넣기 (누적 delta 대신 사용) */
const CHILD_DROP_WIDTH_RATIO = 0.55;

type DropTarget = { id: string; mode: "child" | "sibling" } | null;

export function Sidebar() {
  const pointerRef = useRef({ x: 0, y: 0 });
  const [query, setQuery] = useState("");
  const [moveTargetId, setMoveTargetId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);
  const tree = usePageStore((s) => filterPageTree(s, query));
  const createPage = usePageStore((s) => s.createPage);
  const movePage = usePageStore((s) => s.movePage);
  const pagesMap = usePageStore((s) => s.pages);
  const dndEnabled = query.trim().length === 0;

  const duplicatePage = usePageStore((s) => s.duplicatePage);
  const setActivePage = usePageStore((s) => s.setActivePage);
  const activePageId = usePageStore((s) => s.activePageId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isEditorFocused =
        activeEl?.classList.contains("ProseMirror") ||
        activeEl?.closest(".ProseMirror") !== null;
      if (isEditorFocused) return;

      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "d" || e.key === "D") && activePageId) {
        e.preventDefault();
        const newId = duplicatePage(activePageId);
        if (newId) setActivePage(newId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activePageId, duplicatePage, setActivePage]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const onDragMove = (event: DragMoveEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      setDropTarget(null);
      return;
    }
    const overRect = over.rect;
    const relX = pointerRef.current.x - overRect.left;
    const ratio = relX / Math.max(overRect.width, 1);
    const overId = String(over.id);
    setDropTarget({
      id: overId,
      mode: ratio >= CHILD_DROP_WIDTH_RATIO ? "child" : "sibling",
    });
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setDropTarget(null);
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const activePage = pagesMap[activeId];
    const overPage = pagesMap[overId];
    if (!activePage || !overPage) return;

    const overRect = over.rect;
    const relX = pointerRef.current.x - overRect.left;
    const ratio = relX / Math.max(overRect.width, 1);
    const nestAsChild = ratio >= CHILD_DROP_WIDTH_RATIO;

    if (nestAsChild) {
      movePage(activeId, overId, Number.MAX_SAFE_INTEGER);
      return;
    }

    const targetParent = overPage.parentId;
    const siblings = Object.values(pagesMap)
      .filter((p) => p.parentId === targetParent && p.id !== activeId)
      .sort((a, b) => a.order - b.order);
    const overIndex = siblings.findIndex((p) => p.id === overId);
    if (overIndex === -1) return;
    movePage(activeId, targetParent, overIndex);
  };

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 px-2 py-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-2 flex items-center gap-1.5 px-1">
        <h2 className="flex-1 text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          QuickNote
        </h2>
        <button
          type="button"
          onClick={() => createPage()}
          className="rounded-md p-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          aria-label="새 페이지"
          title="새 페이지 (Cmd/Ctrl+N)"
        >
          <Plus size={16} />
        </button>
      </div>
      <div className="mb-2 flex items-center gap-1.5 rounded-md bg-white px-2 py-1 ring-1 ring-zinc-200 focus-within:ring-zinc-400 dark:bg-zinc-950 dark:ring-zinc-800 dark:focus-within:ring-zinc-600">
        <Search size={13} className="text-zinc-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="페이지 검색"
          className="flex-1 bg-transparent text-xs outline-none placeholder:text-zinc-400"
          data-search-input="true"
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {tree.length === 0 ? (
          <p className="mt-4 px-2 text-xs text-zinc-400">
            {query
              ? "일치하는 페이지가 없습니다."
              : "+ 버튼으로 페이지를 만드세요."}
          </p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragMove={onDragMove}
            onDragEnd={onDragEnd}
            onDragCancel={() => setDropTarget(null)}
          >
            <PageListGroup
              nodes={tree}
              depth={0}
              draggable={dndEnabled}
              onMove={setMoveTargetId}
              dropTarget={dropTarget}
            />
          </DndContext>
        )}
      </div>
      <PageMoveDialog
        pageId={moveTargetId}
        onClose={() => setMoveTargetId(null)}
      />
    </aside>
  );
}
