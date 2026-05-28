import { useMemo, useState } from "react";
import type { ColumnDef } from "../../../types/database";
import { useDatabaseStore } from "../../../store/databaseStore";
import { usePageStore } from "../../../store/pageStore";
import { computeProgressFromSource } from "../../../lib/database/columnSource";

type Props = {
  /** 진행률 컬럼 자체 — config.progressSource 가 있으면 자동 계산 모드. */
  column: ColumnDef;
  /** 현재 행(데이터베이스 row 페이지) id — linkedPagesFromColumn 모드에서 필요. */
  rowId: string;
  value: number | null;
  onChange: (v: number | null) => void;
};

export function ProgressCell({ column, rowId, value, onChange }: Props) {
  const databases = useDatabaseStore((s) => s.databases);
  const pages = usePageStore((s) => s.pages);

  const computed = useMemo(
    () => computeProgressFromSource(column, databases, pages, { currentRowPageId: rowId }),
    [column, databases, pages, rowId],
  );

  // 자동 계산 모드: 값을 무시하고 계산된 값을 표시(편집 불가).
  const isAuto = computed !== null;
  const pct = isAuto
    ? computed!
    : typeof value === "number"
      ? Math.min(100, Math.max(0, Math.round(value)))
      : 0;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(pct));

  const commit = () => {
    const n = parseInt(draft, 10);
    if (!Number.isNaN(n)) {
      onChange(Math.min(100, Math.max(0, n)));
    } else {
      setDraft(String(pct));
    }
    setEditing(false);
  };

  if (editing && !isAuto) {
    return (
      <input
        autoFocus
        type="number"
        min={0}
        max={100}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") { setDraft(String(pct)); setEditing(false); }
        }}
        className="w-full rounded border border-blue-400 px-1 py-0.5 text-sm outline-none"
      />
    );
  }

  return (
    <div
      className={[
        "flex w-full items-center gap-2 px-1 py-0.5",
        isAuto ? "cursor-default" : "cursor-text",
      ].join(" ")}
      onDoubleClick={() => {
        if (isAuto) return;
        setDraft(String(pct));
        setEditing(true);
      }}
      title={isAuto ? "자동 계산 — 컬럼 메뉴에서 소스 변경" : "더블클릭하여 수정"}
    >
      <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
        <div
          className={[
            "h-full rounded-full transition-all",
            isAuto ? "bg-emerald-500" : "bg-blue-500",
          ].join(" ")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-10 shrink-0 text-right text-xs text-zinc-600 dark:text-zinc-400">
        {pct}%
      </span>
    </div>
  );
}
