import { useMemo } from "react";
import type { DatabaseHistorySnapshot } from "../../lib/history/databaseHistoryPatch";

/**
 * DB 구조 버전 diff — 실제 테이블 헤더 모습(컬럼 칩 스트립)으로 보여준다.
 * 추가=초록, 삭제=빨강 취소선, 설정 변경=노랑. 순서는 after 기준, 삭제 컬럼은 뒤에 붙인다.
 */

type PreviewColumn = {
  id: string;
  name?: string | null;
  type?: string | null;
  config?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseColumns(value: unknown): PreviewColumn[] {
  let parsed: unknown = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (column): column is PreviewColumn => isRecord(column) && typeof column.id === "string",
  );
}

function stableJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

type ChipState = "added" | "removed" | "modified" | "unchanged";

const CHIP_CLASS: Record<ChipState, string> = {
  added:
    "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
  removed:
    "border-red-300 bg-red-50 text-red-700 line-through dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
  modified:
    "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
  unchanged:
    "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300",
};

type Props = {
  before: DatabaseHistorySnapshot | null;
  after: DatabaseHistorySnapshot | null;
};

export function DatabaseStructureDiffView({ before, after }: Props) {
  const chips = useMemo(() => {
    const beforeColumns = parseColumns(before?.columns);
    const afterColumns = parseColumns(after?.columns);
    const beforeById = new Map(beforeColumns.map((c) => [c.id, c]));
    const afterIds = new Set(afterColumns.map((c) => c.id));
    const out: Array<{ id: string; label: string; type: string | null; state: ChipState }> = [];
    for (const column of afterColumns) {
      const prev = beforeById.get(column.id);
      const state: ChipState = !prev
        ? "added"
        : prev.name !== column.name ||
            prev.type !== column.type ||
            stableJson(prev.config) !== stableJson(column.config)
          ? "modified"
          : "unchanged";
      out.push({
        id: column.id,
        label: column.name ?? column.id,
        type: column.type ?? null,
        state,
      });
    }
    for (const column of beforeColumns) {
      if (afterIds.has(column.id)) continue;
      out.push({
        id: column.id,
        label: column.name ?? column.id,
        type: column.type ?? null,
        state: "removed",
      });
    }
    return out;
  }, [before, after]);

  if (chips.length === 0) return null;
  const changedCount = chips.filter((c) => c.state !== "unchanged").length;

  return (
    <div className="rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-zinc-800 dark:text-zinc-100">테이블 구조</span>
        {changedCount > 0 ? (
          <span className="shrink-0 text-xs text-zinc-400">컬럼 변경 {changedCount}건</span>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((chip) => (
          <span
            key={chip.id}
            className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs ${CHIP_CLASS[chip.state]}`}
            title={chip.type ? `타입: ${chip.type}` : undefined}
          >
            {chip.label}
            {chip.type ? <span className="opacity-60">{chip.type}</span> : null}
          </span>
        ))}
      </div>
    </div>
  );
}
