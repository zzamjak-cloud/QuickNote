import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GripVertical, Plus, X } from "lucide-react";
import type { ColumnDef, SelectOption } from "../../types/database";
import { useDatabaseStore } from "../../store/databaseStore";
import { newId } from "../../lib/id";
import { SELECT_COLOR_PRESETS } from "./selectColorPresets";

type Props = {
  databaseId: string;
  column: ColumnDef;
};

export function ColumnOptionsEditor({ databaseId, column }: Props) {
  const updateColumn = useDatabaseStore((s) => s.updateColumn);
  const opts = column.config?.options ?? [];
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const patchOptions = (next: SelectOption[]) => {
    updateColumn(databaseId, column.id, {
      config: { ...column.config, options: next },
    });
  };

  const moveOption = () => {
    if (dragFrom == null || dragOver == null || dragFrom === dragOver) {
      setDragFrom(null);
      setDragOver(null);
      return;
    }
    const next = [...opts];
    const [moved] = next.splice(dragFrom, 1);
    if (moved) next.splice(dragOver, 0, moved);
    patchOptions(next);
    setDragFrom(null);
    setDragOver(null);
  };

  // 일반 옵션과 구분선 분리 — 라벨 자동 번호에 사용
  const nonDividerCount = opts.filter((o) => !o.divider).length;

  return (
    <div className="ml-4 mt-2 space-y-1 border-l border-zinc-100 pl-2 dark:border-zinc-800">
      <div className="text-sm font-medium text-zinc-500">선택 옵션</div>
      {opts.map((o, idx) => (
        <div
          key={o.id}
          onDragOver={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setDragOver(idx);
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            moveOption();
          }}
          className={[
            "flex items-center gap-1 rounded",
            dragFrom != null && dragOver === idx && dragFrom !== idx
              ? "ring-1 ring-blue-400"
              : "",
          ].join(" ")}
        >
          <button
            type="button"
            draggable
            title={o.divider ? "구분선 순서 변경" : "옵션 순서 변경"}
            onDragStart={(event) => {
              event.stopPropagation();
              event.dataTransfer.effectAllowed = "move";
              setDragFrom(idx);
              setDragOver(idx);
            }}
            onDragEnd={(event) => {
              event.stopPropagation();
              setDragFrom(null);
              setDragOver(null);
            }}
            className="cursor-grab rounded p-0.5 text-zinc-400 hover:bg-zinc-100 active:cursor-grabbing dark:hover:bg-zinc-800"
          >
            <GripVertical size={12} />
          </button>

          {o.divider ? (
            // 구분선 행 — 라벨·색상 편집 없이 가로선으로 시각화
            <div className="flex flex-1 items-center gap-2 px-1 py-1.5">
              <div className="h-px flex-1 bg-zinc-300 dark:bg-zinc-600" />
              <span className="text-[10px] uppercase tracking-wide text-zinc-400">구분선</span>
              <div className="h-px flex-1 bg-zinc-300 dark:bg-zinc-600" />
            </div>
          ) : (
            <>
              <OptionColorSwatch
                color={o.color ?? SELECT_COLOR_PRESETS[0]!}
                onPick={(color) =>
                  patchOptions(
                    opts.map((x) => (x.id === o.id ? { ...x, color } : x)),
                  )
                }
              />
              <input
                value={o.label}
                onChange={(e) =>
                  patchOptions(
                    opts.map((x) =>
                      x.id === o.id ? { ...x, label: e.target.value } : x,
                    ),
                  )
                }
                className="min-w-0 flex-1 rounded border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
            </>
          )}

          <button
            type="button"
            title={o.divider ? "구분선 삭제" : "옵션 삭제"}
            className="rounded p-0.5 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
            onClick={() => patchOptions(opts.filter((x) => x.id !== o.id))}
          >
            <X size={12} />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() =>
            patchOptions([
              ...opts,
              {
                id: newId(),
                label: `옵션 ${nonDividerCount + 1}`,
                color: SELECT_COLOR_PRESETS[nonDividerCount % SELECT_COLOR_PRESETS.length],
              },
            ])
          }
          className="flex items-center gap-1 text-[11px] text-blue-600 hover:underline dark:text-blue-400"
        >
          <Plus size={14} /> 옵션 추가
        </button>
        <button
          type="button"
          onClick={() =>
            patchOptions([
              ...opts,
              { id: newId(), label: "", divider: true },
            ])
          }
          className="flex items-center gap-1 text-[11px] text-zinc-500 hover:underline"
        >
          <Plus size={14} /> 구분선 추가
        </button>
      </div>
    </div>
  );
}

// 컬러 원을 클릭하면 팝오버로 프리셋 선택 UI를 표시한다.
function OptionColorSwatch({
  color,
  onPick,
}: {
  color: string;
  onPick: (c: string) => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      setCoords({ top: rect.bottom + 4, left: Math.max(8, rect.left) });
    }
    setOpen(true);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title="색상 변경"
        onClick={toggle}
        className="h-4 w-4 shrink-0 rounded-full border border-white shadow ring-1 ring-zinc-200 hover:ring-zinc-400 dark:border-zinc-900 dark:ring-zinc-700"
        style={{ backgroundColor: color }}
      />
      {open && coords &&
        createPortal(
          <div
            ref={popRef}
            data-qn-color-picker
            style={{ position: "fixed", top: coords.top, left: coords.left }}
            className="z-[760] flex gap-1 rounded-md border border-zinc-200 bg-white p-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          >
            {SELECT_COLOR_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`색상 ${c}`}
                title={c}
                onClick={() => {
                  onPick(c);
                  setOpen(false);
                }}
                className={[
                  "h-4 w-4 rounded-full border",
                  c === color
                    ? "border-zinc-900 ring-2 ring-zinc-300 dark:border-white dark:ring-zinc-600"
                    : "border-white ring-1 ring-zinc-200 dark:border-zinc-900 dark:ring-zinc-700",
                ].join(" ")}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
