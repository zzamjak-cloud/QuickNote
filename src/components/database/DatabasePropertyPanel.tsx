import { useState } from "react";
import { Plus } from "lucide-react";
import type { ColumnType } from "../../types/database";
import { useDatabaseStore, defaultColumnForType } from "../../store/databaseStore";
import { usePageStore } from "../../store/pageStore";
import { DatabaseCell } from "./DatabaseCell";

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

export function DatabasePropertyPanel({
  databaseId,
  pageId,
}: {
  databaseId: string;
  pageId: string;
}) {
  const bundle = useDatabaseStore((s) => s.databases[databaseId]);
  const page = usePageStore((s) => s.pages[pageId]);
  const addColumn = useDatabaseStore((s) => s.addColumn);
  const [showAdd, setShowAdd] = useState(false);

  if (!bundle || !page) return null;

  return (
    <div className="my-3 space-y-1 border-y border-zinc-200 py-3 text-xs dark:border-zinc-800">
      {bundle.columns
        .filter((c) => c.type !== "title")
        .map((col) => {
          const value = (col.id in (page.dbCells ?? {}))
            ? page.dbCells![col.id]
            : null;
          return (
            <div key={col.id} className="flex items-start gap-2">
              <div className="w-32 shrink-0 truncate pt-0.5 text-zinc-500">
                {col.name}
              </div>
              <div className="min-w-0 flex-1">
                <DatabaseCell
                  databaseId={databaseId}
                  rowId={pageId}
                  column={col}
                  value={value}
                />
              </div>
            </div>
          );
        })}
      <div className="pt-2">
        {showAdd ? (
          <select
            autoFocus
            defaultValue=""
            onBlur={() => setShowAdd(false)}
            onChange={(e) => {
              const t = e.target.value as ColumnType | "";
              if (t) {
                const label = COLUMN_TYPES.find((x) => x.id === t)?.label ?? "속성";
                const idx = bundle.columns.length + 1;
                addColumn(databaseId, defaultColumnForType(t, `${label} ${idx}`));
              }
              setShowAdd(false);
            }}
            className="rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-600 dark:bg-zinc-900"
          >
            <option value="">선택…</option>
            {COLUMN_TYPES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        ) : (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1 rounded px-1 py-0.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <Plus size={12} /> 속성 추가
          </button>
        )}
      </div>
    </div>
  );
}
