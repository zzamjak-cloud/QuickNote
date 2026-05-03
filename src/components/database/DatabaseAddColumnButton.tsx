import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { ColumnType } from "../../types/database";
import { defaultColumnForType, useDatabaseStore } from "../../store/databaseStore";

const COLUMN_TYPES: { id: ColumnType; label: string }[] = [
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

export function DatabaseAddColumnButton({ databaseId }: { databaseId: string }) {
  const addColumn = useDatabaseStore((s) => s.addColumn);
  const bundle = useDatabaseStore((s) => s.databases[databaseId]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, []);

  return (
    <th className="relative w-8 border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-700">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="속성 추가"
        className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        <Plus size={14} />
      </button>
      {open && (
        <div
          ref={ref}
          className="absolute right-0 z-30 mt-1 w-48 rounded-md border border-zinc-200 bg-white p-1 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          <div className="px-2 py-1 text-[10px] uppercase text-zinc-500">속성 타입</div>
          {COLUMN_TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                if (!bundle) return;
                const idx = bundle.columns.length + 1;
                addColumn(databaseId, defaultColumnForType(t.id, `${t.label} ${idx}`));
                setOpen(false);
              }}
              className="block w-full rounded px-2 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
    </th>
  );
}
