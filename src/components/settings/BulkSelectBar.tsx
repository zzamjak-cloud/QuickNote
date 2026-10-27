type Props = {
  total: number;
  selectedCount: number;
  onToggleAll: () => void;
  actionLabel: string;
  onAction: () => void;
  busy: boolean;
};

/** 목록 상단 일괄 선택 바: 전체 선택 체크박스 + 선택 개수 + 일괄 작업 버튼 */
export function BulkSelectBar({ total, selectedCount, onToggleAll, actionLabel, onAction, busy }: Props) {
  if (total === 0) return null;
  return (
    <div className="flex h-8 items-center justify-between gap-2">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          aria-label="전체 선택"
          checked={selectedCount === total}
          ref={(el) => {
            if (el) el.indeterminate = selectedCount > 0 && selectedCount < total;
          }}
          disabled={busy}
          onChange={onToggleAll}
        />
        {selectedCount > 0 && <span className="text-zinc-500">{selectedCount}개 선택</span>}
      </label>
      {selectedCount > 0 && (
        <button
          type="button"
          onClick={onAction}
          disabled={busy}
          className="rounded border border-red-200 px-2 py-1 text-sm text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/40"
        >
          {busy ? "처리 중..." : actionLabel}
        </button>
      )}
    </div>
  );
}
