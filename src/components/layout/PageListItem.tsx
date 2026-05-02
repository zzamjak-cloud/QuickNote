import { useState, useEffect, useRef } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Trash2, GripVertical } from "lucide-react";
import type { Page } from "../../types/page";
import { usePageStore } from "../../store/pageStore";

type Props = {
  page: Page;
  active: boolean;
  draggable: boolean;
};

export function PageListItem({ page, active, draggable }: Props) {
  const setActivePage = usePageStore((s) => s.setActivePage);
  const renamePage = usePageStore((s) => s.renamePage);
  const deletePage = usePageStore((s) => s.deletePage);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(page.title);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const sortable = useSortable({ id: page.id, disabled: !draggable });

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  useEffect(() => {
    setDraft(page.title);
  }, [page.title]);

  const commit = () => {
    const next = draft.trim() || "제목 없음";
    if (next !== page.title) renamePage(page.id, next);
    setEditing(false);
  };

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className={[
        "group flex items-center gap-1 rounded-md px-1.5 py-1 text-sm",
        active
          ? "bg-zinc-200/80 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
          : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800/60",
      ].join(" ")}
    >
      {draggable && (
        <button
          type="button"
          {...sortable.attributes}
          {...sortable.listeners}
          className="cursor-grab text-zinc-400 opacity-0 transition group-hover:opacity-100 active:cursor-grabbing"
          aria-label="드래그하여 이동"
        >
          <GripVertical size={14} />
        </button>
      )}
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(page.title);
              setEditing(false);
            }
          }}
          className="flex-1 bg-transparent outline-none"
        />
      ) : (
        <button
          type="button"
          className="flex-1 truncate text-left"
          onClick={() => setActivePage(page.id)}
          onDoubleClick={() => setEditing(true)}
          title="더블클릭하여 이름 변경"
        >
          {page.icon ? (
            <span className="mr-1.5">{page.icon}</span>
          ) : null}
          {page.title || "제목 없음"}
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          if (confirm(`"${page.title}" 페이지를 삭제하시겠습니까?`)) {
            deletePage(page.id);
          }
        }}
        className="text-zinc-400 opacity-0 transition hover:text-red-500 group-hover:opacity-100"
        aria-label="페이지 삭제"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
