import { useEffect, useRef, useState } from "react";
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

  // 핸들 위치 — th BoundingClientRect 를 state 로 추적해 portal 핸들이 올바른 위치에 그려지도록.
  // 렌더 사이클의 IIFE 로는 초기 null ref / 0px rect 문제가 발생하므로 useEffect 로 업데이트.
  const [thRect, setThRect] = useState<DOMRect | null>(null);
  // portal span 은 body 에 있어 th 의 group-hover 와 연결 불가 — isHovered 로 명시적 제어
  const [isHovered, setIsHovered] = useState(false);
  useEffect(() => {
    const th = thRef.current;
    if (!th) return;
    const update = () => setThRect(th.getBoundingClientRect());
    update();
    // 스크롤·리사이즈 시 위치 동기화
    const scroller = th.closest<HTMLElement>(".overflow-x-auto, .overflow-y-auto");
    scroller?.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    return () => {
      scroller?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  // 드래그 종료 안전망 — dragend 가 portal span 에서 누락되는 브라우저 quirk 대응
  useEffect(() => {
    const cleanup = () => document.body.classList.remove("quicknote-db-col-dragging");
    window.addEventListener("dragend", cleanup);
    return () => window.removeEventListener("dragend", cleanup);
  }, []);

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
      onMouseEnter={() => {
        setIsHovered(true);
        const th = thRef.current;
        if (th) setThRect(th.getBoundingClientRect());
      }}
      onMouseLeave={() => setIsHovered(false)}
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
        // 드롭 대상 — 파란 ring-inset (점선 제거)
        highlightDrop !== null ? "ring-2 ring-inset ring-blue-500" : "",
      ].join(" ")}
    >
      {/* 헤더 상단 경계에 반쯤 걸친 드래그 핸들 — hover 시만 표시, portal로 overflow 클리핑 우회 */}
      {createPortal(
        <span
          draggable
          onMouseEnter={() => {
            // hover 시 rect 최신화 — 스크롤 후 위치가 어긋나는 것 방지
            const th = thRef.current;
            if (th) setThRect(th.getBoundingClientRect());
          }}
          onDragStart={(e) => {
            e.stopPropagation();
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData(DRAG_MIME, `col:${index}`);
            // 브라우저 ghost 이미지 제거 — DOM에 먼저 추가 후 setDragImage
            const img = document.createElement("img");
            img.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
            img.style.position = "fixed";
            img.style.top = "-9999px";
            document.body.appendChild(img);
            e.dataTransfer.setDragImage(img, 0, 0);
            requestAnimationFrame(() => img.remove());
            // DB 컬럼 드래그 중 — dropcursor/indicator 숨김
            document.body.classList.add("quicknote-db-col-dragging");
            onDragStart(index);
          }}
          onDragEnd={(e) => {
            e.stopPropagation();
            document.body.classList.remove("quicknote-db-col-dragging");
          }}
          style={
            thRect
              ? {
                  position: "fixed" as const,
                  left: thRect.left + thRect.width / 2 - 12,
                  top: thRect.top - 10,
                  zIndex: 9999,
                }
              : { display: "none" }
          }
          className={`flex h-6 w-6 cursor-grab items-center justify-center rounded-md border border-zinc-200 bg-white/95 text-zinc-500 shadow-sm transition-opacity active:cursor-grabbing dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-300 ${isHovered ? "opacity-100" : "opacity-0"}`}
          title="컬럼 이동"
        >
          <GripVertical size={12} />
        </span>,
        document.body,
      )}

      <div className="flex items-center">
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
