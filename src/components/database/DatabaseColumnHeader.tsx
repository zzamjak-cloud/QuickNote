import { useEffect, useRef, useState } from "react";
import { GripVertical, ChevronDown } from "lucide-react";
import type { ColumnDef } from "../../types/database";
import { useDatabaseStore } from "../../store/databaseStore";
import { useUiStore } from "../../store/uiStore";
import { DatabaseColumnMenu } from "./DatabaseColumnMenu";

const DRAG_MIME = "application/x-quicknote-db-drag";
const MIN_COL_WIDTH = 60;

type Props = {
  databaseId: string;
  column: ColumnDef;
  index: number;
  onDragStart: (idx: number) => void;
  onDragOver: (idx: number) => void;
  onDrop: () => void;
  highlightDrop?: "left" | "right" | null;
};

export function DatabaseColumnHeader({
  databaseId,
  column,
  index,
  onDragStart,
  onDragOver,
  onDrop,
  highlightDrop,
}: Props) {
  const updateColumn = useDatabaseStore((s) => s.updateColumn);
  const openColumnMenuId = useUiStore((s) => s.openColumnMenuId);
  const setOpenColumnMenu = useUiStore((s) => s.setOpenColumnMenu);
  const menuOpen = openColumnMenuId === column.id;
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(column.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const thRef = useRef<HTMLTableCellElement>(null);

  useEffect(() => { setDraft(column.name); }, [column.name]);
  useEffect(() => {
    if (renaming) inputRef.current?.focus();
  }, [renaming]);

  const commitName = () => {
    const t = draft.trim() || "속성";
    if (t !== column.name) updateColumn(databaseId, column.id, { name: t });
    setRenaming(false);
  };

  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = thRef.current?.offsetWidth ?? 120;
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(MIN_COL_WIDTH, startWidth + (ev.clientX - startX));
      updateColumn(databaseId, column.id, { width: next });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
  };

  return (
    <th
      ref={thRef}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDragOver(index);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDrop();
      }}
      className={[
        "group relative whitespace-nowrap border-b border-zinc-200 px-2 py-1.5 font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-400",
        highlightDrop === "left" ? "border-l-2 border-l-blue-500" : "",
        highlightDrop === "right" ? "border-r-2 border-r-blue-500" : "",
      ].join(" ")}
    >
      <div className="flex items-center gap-1">
        <span
          draggable
          onDragStart={(e) => {
            e.stopPropagation();
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData(DRAG_MIME, `col:${index}`);
            onDragStart(index);
          }}
          onDragEnd={(e) => e.stopPropagation()}
          className="cursor-grab opacity-0 group-hover:opacity-100 active:cursor-grabbing"
          title="컬럼 이동"
        >
          <GripVertical size={12} className="text-zinc-400" />
        </span>

        {renaming ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              if (e.key === "Escape") { setDraft(column.name); setRenaming(false); }
            }}
            className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-1 text-xs dark:border-zinc-600 dark:bg-zinc-900"
          />
        ) : (
          <button
            type="button"
            onClick={() => setOpenColumnMenu(menuOpen ? null : column.id)}
            onDoubleClick={() => setRenaming(true)}
            className="flex flex-1 items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
            title="더블클릭하여 이름 변경"
          >
            <span className="truncate">{column.name}</span>
            <ChevronDown size={10} className="ml-auto opacity-0 group-hover:opacity-60" />
          </button>
        )}
      </div>

      {/* 리사이즈 핸들 — 우측 모서리 4px, hover 시 파란 인디케이터 */}
      <div
        onMouseDown={onResizeStart}
        onClick={(e) => e.stopPropagation()}
        className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-blue-400/60"
        title="컬럼 너비 조절"
      />

      {menuOpen && (
        <DatabaseColumnMenu
          databaseId={databaseId}
          column={column}
          anchorEl={thRef.current}
          onClose={() => setOpenColumnMenu(null)}
        />
      )}
    </th>
  );
}
