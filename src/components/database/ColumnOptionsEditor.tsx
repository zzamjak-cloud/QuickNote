import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, X } from "lucide-react";
import type { ColumnDef, SelectOption } from "../../types/database";
import { useDatabaseStore } from "../../store/databaseStore";
import { newId } from "../../lib/id";

export const SELECT_COLOR_PRESETS = [
  "#64748b",
  "#2563eb",
  "#16a34a",
  "#ca8a04",
  "#dc2626",
  "#9333ea",
  "#0891b2",
  "#db2777",
];

type Props = {
  databaseId: string;
  column: ColumnDef;
};

export function ColumnOptionsEditor({ databaseId, column }: Props) {
  const updateColumn = useDatabaseStore((s) => s.updateColumn);
  const opts = column.config?.options ?? [];

  const patchOptions = (next: SelectOption[]) => {
    updateColumn(databaseId, column.id, {
      config: { ...column.config, options: next },
    });
  };

  return (
    <div className="ml-4 mt-2 space-y-1 border-l border-zinc-100 pl-2 dark:border-zinc-800">
      <div className="text-[10px] font-medium text-zinc-500">선택 옵션</div>
      {opts.map((o) => (
        <div key={o.id} className="flex items-center gap-1">
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
            className="min-w-0 flex-1 rounded border border-zinc-200 px-1 py-0.5 text-[11px] dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="button"
            title="옵션 삭제"
            className="rounded p-0.5 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
            onClick={() => patchOptions(opts.filter((x) => x.id !== o.id))}
          >
            <X size={12} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          patchOptions([
            ...opts,
            {
              id: newId(),
              label: `옵션 ${opts.length + 1}`,
              color: SELECT_COLOR_PRESETS[opts.length % SELECT_COLOR_PRESETS.length],
            },
          ])
        }
        className="flex items-center gap-1 text-[11px] text-blue-600 hover:underline dark:text-blue-400"
      >
        <Plus size={12} /> 옵션 추가
      </button>
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
            className="z-[500] flex gap-1 rounded-md border border-zinc-200 bg-white p-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
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
