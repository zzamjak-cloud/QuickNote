import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GripVertical, ChevronDown } from "lucide-react";
import type { ColumnDef } from "../../types/database";
import { useUiStore } from "../../store/uiStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { DatabaseColumnMenu } from "./DatabaseColumnMenu";

const DRAG_MIME = "application/x-quicknote-db-drag";
/** 사용자가 드래그로 임의 폭으로 줄일 수 있도록 최소값을 매우 작게 — 보이긴 해야 하므로 12px. */
const MIN_COL_WIDTH = 12;

type Props = {
  databaseId: string;
  column: ColumnDef;
  index: number;
  onDragStart: (idx: number) => void;
  onDragOver: (idx: number) => void;
  onDrop: () => void;
  highlightDrop?: "left" | "right" | null;
  /** 헤더 우측 리사이즈 핸들 더블클릭 시 호출 — 컬럼 내용 폭에 맞춰 자동 조정 */
  onAutoFit?: () => void;
};

export function DatabaseColumnHeader({
  databaseId,
  column,
  index,
  onDragStart,
  onDragOver,
  onDrop,
  highlightDrop,
  onAutoFit,
}: Props) {
  const updateColumn = useDatabaseStore((s) => s.updateColumn);
  const openColumnMenuId = useUiStore((s) => s.openColumnMenuId);
  const setOpenColumnMenu = useUiStore((s) => s.setOpenColumnMenu);
  const menuOpen = openColumnMenuId === column.id;
  const thRef = useRef<HTMLTableCellElement>(null);

  // 노션 스타일 — 드래그 중엔 컬럼 폭을 즉시 갱신하지 않고 가이드 라인만 표시,
  // mouseup 에서 한 번만 width 커밋. 다른 컬럼 폭이 매 프레임 재배분되며 흔들리는 문제 방지.
  const [resizeGuideX, setResizeGuideX] = useState<number | null>(null);
  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = thRef.current?.offsetWidth ?? 120;
    setResizeGuideX(startX);
    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const proposed = Math.max(MIN_COL_WIDTH, startWidth + delta);
      // 라인 위치는 실제 적용될 우측 경계 좌표(= 시작점 + clamped delta)
      const clampedX = startX + (proposed - startWidth);
      setResizeGuideX(clampedX);
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      setResizeGuideX(null);
      const finalWidth = Math.max(MIN_COL_WIDTH, startWidth + (ev.clientX - startX));
      if (finalWidth !== startWidth) {
        updateColumn(databaseId, column.id, { width: finalWidth });
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
  };

  return (
    <th
      ref={thRef}
      data-qn-col-id={column.id}
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
        // sticky thead 시 본문이 비치지 않도록 bg를 셀에 직접 부여.
        "group relative whitespace-nowrap border-b border-zinc-200 bg-white px-2 py-1.5 font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400",
        highlightDrop === "left" ? "border-l-2 border-dashed border-l-blue-400" : "",
        highlightDrop === "right" ? "border-r-2 border-dashed border-r-blue-400" : "",
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

        <button
          type="button"
          onClick={() => setOpenColumnMenu(menuOpen ? null : column.id)}
          className="flex flex-1 items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
          title="클릭하여 속성 편집"
        >
          <span className="truncate">{column.name}</span>
          <ChevronDown size={10} className="ml-auto opacity-0 group-hover:opacity-60" />
        </button>
      </div>

      {/* 리사이즈 핸들 — 우측 모서리 4px, hover 시 파란 인디케이터, 더블클릭으로 자동 맞춤 */}
      <div
        onMouseDown={onResizeStart}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onAutoFit?.();
        }}
        className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-blue-400/60"
        title="드래그: 너비 조절 / 더블클릭: 내용 폭에 맞춤"
      />

      {menuOpen && (
        <DatabaseColumnMenu
          databaseId={databaseId}
          column={column}
          anchorEl={thRef.current}
          onClose={() => setOpenColumnMenu(null)}
        />
      )}
      {resizeGuideX != null &&
        createPortal(
          <div
            aria-hidden
            className="pointer-events-none fixed top-0 bottom-0 z-50 w-px bg-blue-500"
            style={{ left: resizeGuideX }}
          />,
          document.body,
        )}
    </th>
  );
}
