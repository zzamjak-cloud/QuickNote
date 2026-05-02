import { useEffect, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronRight,
  ChevronDown,
  GripVertical,
  Plus,
  Trash2,
  ArrowUpToLine,
  MoveRight,
} from "lucide-react";
import type { PageNode } from "../../store/pageStore";
import { usePageStore } from "../../store/pageStore";
import { useSettingsStore } from "../../store/settingsStore";
import { PageListGroup } from "./PageListGroup";

type Props = {
  node: PageNode;
  depth: number;
  draggable: boolean;
  onMove: (id: string) => void;
};

export function PageListItem({ node, depth, draggable, onMove }: Props) {
  const setActivePage = usePageStore((s) => s.setActivePage);
  const renamePage = usePageStore((s) => s.renamePage);
  const deletePage = usePageStore((s) => s.deletePage);
  const createPage = usePageStore((s) => s.createPage);
  const movePage = usePageStore((s) => s.movePage);
  const activePageId = usePageStore((s) => s.activePageId);
  const expanded = useSettingsStore((s) =>
    s.expandedIds.includes(node.id),
  );
  const toggleExpanded = useSettingsStore((s) => s.toggleExpanded);
  const setExpanded = useSettingsStore((s) => s.setExpanded);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.title);
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const sortable = useSortable({ id: node.id, disabled: !draggable });

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  useEffect(() => {
    setDraft(node.title);
  }, [node.title]);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  const commit = () => {
    const next = draft.trim() || "제목 없음";
    if (next !== node.title) renamePage(node.id, next);
    setEditing(false);
  };

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.4 : 1,
  };

  const hasChildren = node.children.length > 0;
  const active = node.id === activePageId;

  return (
    <div ref={sortable.setNodeRef} style={style}>
      <div
        className={[
          "group relative flex items-center gap-1 rounded-md py-1 pr-1 text-sm",
          active
            ? "bg-zinc-200/80 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
            : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800/60",
        ].join(" ")}
        style={{ paddingLeft: depth * 14 + 4 }}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuOpen(true);
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => toggleExpanded(node.id)}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            aria-label={expanded ? "접기" : "펼치기"}
          >
            {expanded ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )}
          </button>
        ) : (
          <span className="inline-block h-5 w-5 shrink-0" />
        )}
        {draggable && (
          <button
            type="button"
            {...sortable.attributes}
            {...sortable.listeners}
            className="cursor-grab text-zinc-400 opacity-0 transition group-hover:opacity-100 active:cursor-grabbing"
            aria-label="드래그하여 이동"
          >
            <GripVertical size={12} />
          </button>
        )}
        <span className="w-5 shrink-0 text-center text-base leading-5">
          {node.icon ?? "·"}
        </span>
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setDraft(node.title);
                setEditing(false);
              }
            }}
            className="flex-1 bg-transparent outline-none"
          />
        ) : (
          <button
            type="button"
            className="flex-1 truncate text-left"
            onClick={() => setActivePage(node.id)}
            onDoubleClick={() => setEditing(true)}
            title="더블클릭하여 이름 변경, 우클릭으로 메뉴"
          >
            {node.title || "제목 없음"}
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            const newId = createPage("새 페이지", node.id);
            setExpanded(node.id, true);
            // 새 페이지는 자동으로 active가 됨 (createPage 내부)
            void newId;
          }}
          className="text-zinc-400 opacity-0 transition hover:text-zinc-900 group-hover:opacity-100 dark:hover:text-zinc-100"
          aria-label="하위 페이지 추가"
          title="하위 페이지 추가"
        >
          <Plus size={14} />
        </button>
        {menuOpen && (
          <div
            ref={menuRef}
            className="absolute right-1 top-full z-30 mt-0.5 w-44 rounded-md border border-zinc-200 bg-white py-1 text-xs shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
          >
            <button
              type="button"
              onClick={() => {
                createPage("새 페이지", node.id);
                setExpanded(node.id, true);
                setMenuOpen(false);
              }}
              className="flex w-full items-center gap-2 px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <Plus size={12} /> 하위 페이지 추가
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(true);
                setMenuOpen(false);
              }}
              className="flex w-full items-center gap-2 px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              이름 변경
            </button>
            <button
              type="button"
              onClick={() => {
                onMove(node.id);
                setMenuOpen(false);
              }}
              className="flex w-full items-center gap-2 px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <MoveRight size={12} /> 다른 페이지로 이동
            </button>
            {node.parentId !== null && (
              <button
                type="button"
                onClick={() => {
                  movePage(node.id, null, Number.MAX_SAFE_INTEGER);
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <ArrowUpToLine size={12} /> 루트로 이동
              </button>
            )}
            <hr className="my-1 border-zinc-200 dark:border-zinc-700" />
            <button
              type="button"
              onClick={() => {
                if (
                  confirm(
                    `"${node.title}" 페이지를 삭제하시겠습니까?${
                      node.children.length > 0
                        ? " 하위 페이지도 함께 삭제됩니다."
                        : ""
                    }`,
                  )
                ) {
                  deletePage(node.id);
                }
                setMenuOpen(false);
              }}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30"
            >
              <Trash2 size={12} /> 삭제
            </button>
          </div>
        )}
      </div>
      {hasChildren && expanded && (
        <PageListGroup
          nodes={node.children}
          depth={depth + 1}
          draggable={draggable}
          onMove={onMove}
        />
      )}
    </div>
  );
}
