import { useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Plus, Search } from "lucide-react";
import {
  usePageStore,
  selectSortedPages,
} from "../../store/pageStore";
import { PageListItem } from "./PageListItem";

export function Sidebar() {
  const pages = usePageStore(selectSortedPages);
  const activePageId = usePageStore((s) => s.activePageId);
  const createPage = usePageStore((s) => s.createPage);
  const reorderPages = usePageStore((s) => s.reorderPages);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pages;
    return pages.filter((p) => p.title.toLowerCase().includes(q));
  }, [pages, query]);

  const dndEnabled = query.trim().length === 0;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = pages.map((p) => p.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, String(active.id));
    reorderPages(next);
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
        {filtered.length === 0 ? (
          <p className="mt-4 px-2 text-xs text-zinc-400">
            {query ? "일치하는 페이지가 없습니다." : "+ 버튼으로 페이지를 만드세요."}
          </p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={filtered.map((p) => p.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="flex flex-col gap-0.5">
                {filtered.map((page) => (
                  <PageListItem
                    key={page.id}
                    page={page}
                    active={page.id === activePageId}
                    draggable={dndEnabled}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </aside>
  );
}
