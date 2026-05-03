import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Trash2, Type } from "lucide-react";
import type { ColumnDef, ColumnType } from "../../types/database";
import { useDatabaseStore } from "../../store/databaseStore";
import { ColumnOptionsEditor } from "./ColumnOptionsEditor";

const TYPE_LABELS: { id: ColumnType; label: string }[] = [
  { id: "text", label: "텍스트" },
  { id: "number", label: "숫자" },
  { id: "select", label: "선택" },
  { id: "multiSelect", label: "다중 선택" },
  { id: "status", label: "상태" },
  { id: "date", label: "날짜" },
  { id: "person", label: "사람" },
  { id: "file", label: "파일" },
  { id: "checkbox", label: "체크박스" },
  { id: "url", label: "URL" },
  { id: "phone", label: "연락처" },
  { id: "email", label: "이메일" },
];

type Props = {
  databaseId: string;
  column: ColumnDef;
  /** 부모 헤더 셀 — 메뉴를 그 아래에 띄우기 위한 기준점 */
  anchorEl?: HTMLElement | null;
  onClose: () => void;
};

export function DatabaseColumnMenu({ databaseId, column, anchorEl, onClose }: Props) {
  const updateColumn = useDatabaseStore((s) => s.updateColumn);
  const removeColumn = useDatabaseStore((s) => s.removeColumn);
  const ref = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const rect = anchorEl?.getBoundingClientRect();
    if (!rect) return;
    const width = 224; // w-56
    const left = Math.min(rect.left, window.innerWidth - width - 8);
    setCoords({ top: rect.bottom + 4, left: Math.max(8, left) });
  }, [anchorEl]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      if (anchorEl?.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [onClose, anchorEl]);

  const isTitle = column.type === "title";
  const isSelectKind =
    column.type === "select" || column.type === "multiSelect" || column.type === "status";

  if (!coords) return null;

  return createPortal(
    <div
      ref={ref}
      style={{ position: "fixed", top: coords.top, left: coords.left, width: 224 }}
      className="z-50 rounded-md border border-zinc-200 bg-white p-1 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
    >
      {!isTitle && (
        <div className="px-2 py-1">
          <div className="flex items-center gap-1 text-[10px] text-zinc-500">
            <Type size={11} /> 타입
          </div>
          <select
            value={column.type}
            onChange={(e) =>
              updateColumn(databaseId, column.id, { type: e.target.value as ColumnType })
            }
            className="mt-0.5 w-full rounded border border-zinc-200 bg-white px-1 py-0.5 dark:border-zinc-700 dark:bg-zinc-900"
          >
            {TYPE_LABELS.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </div>
      )}

      {isSelectKind && (
        <div className="border-t border-zinc-100 px-1 py-1 dark:border-zinc-800">
          <ColumnOptionsEditor databaseId={databaseId} column={column} />
        </div>
      )}

      {!isTitle && (
        <button
          type="button"
          onClick={() => {
            if (!confirming) { setConfirming(true); return; }
            removeColumn(databaseId, column.id);
            onClose();
          }}
          className={[
            "flex w-full items-center gap-2 rounded px-2 py-1",
            confirming
              ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
              : "text-zinc-700 hover:bg-red-50 hover:text-red-600 dark:text-zinc-300 dark:hover:bg-red-950/40",
          ].join(" ")}
        >
          <Trash2 size={12} /> {confirming ? "한 번 더 누르면 삭제" : "삭제"}
        </button>
      )}

      {isTitle && (
        <div className="px-2 py-1 text-[10px] text-zinc-500">
          제목 컬럼은 페이지 제목과 동기화됩니다.
        </div>
      )}
    </div>,
    document.body,
  );
}
