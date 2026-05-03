import { Plus, X } from "lucide-react";
import type { ColumnDef } from "../../types/database";
import { useDatabaseStore } from "../../store/databaseStore";
import { newId } from "../../lib/id";

type Props = {
  databaseId: string;
  column: ColumnDef;
};

export function ColumnOptionsEditor({ databaseId, column }: Props) {
  const updateColumn = useDatabaseStore((s) => s.updateColumn);
  const opts = column.config?.options ?? [];

  const patchOptions = (next: typeof opts) => {
    updateColumn(databaseId, column.id, {
      config: { ...column.config, options: next },
    });
  };

  return (
    <div className="ml-4 mt-2 space-y-1 border-l border-zinc-100 pl-2 dark:border-zinc-800">
      <div className="text-[10px] font-medium text-zinc-500">선택 옵션</div>
      {opts.map((o) => (
        <div key={o.id} className="flex items-center gap-1">
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
            { id: newId(), label: `옵션 ${opts.length + 1}` },
          ])
        }
        className="flex items-center gap-1 text-[11px] text-blue-600 hover:underline dark:text-blue-400"
      >
        <Plus size={12} /> 옵션 추가
      </button>
    </div>
  );
}
