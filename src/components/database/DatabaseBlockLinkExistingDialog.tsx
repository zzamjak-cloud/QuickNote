import type { KeyboardEventHandler } from "react";
import { createPortal } from "react-dom";
import type { DatabaseMeta } from "../../types/database";

type DatabaseRow = { id: string; meta: DatabaseMeta };

type Props = {
  open: boolean;
  isInsidePeek: boolean;
  query: string;
  highlightIndex: number;
  listBaseId: string;
  candidates: DatabaseRow[];
  onQueryChange: (query: string) => void;
  onHighlightChange: (index: number) => void;
  onKeyDown: KeyboardEventHandler<HTMLInputElement>;
  onSelect: (id: string) => void;
  onClose: () => void;
};

/** 연결된 DB 블록에서 다른 기존 DB를 선택하는 dialog. */
export function DatabaseBlockLinkExistingDialog({
  open,
  isInsidePeek,
  query,
  highlightIndex,
  listBaseId,
  candidates,
  onQueryChange,
  onHighlightChange,
  onKeyDown,
  onSelect,
  onClose,
}: Props) {
  if (!open) return null;

  return createPortal(
    <div
      className={`fixed inset-0 ${isInsidePeek ? "z-[710]" : "z-[460]"} flex items-center justify-center bg-black/45 p-4`}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="qn-db-link-existing-title"
        className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3
            id="qn-db-link-existing-title"
            className="text-base font-semibold text-zinc-900 dark:text-zinc-100"
          >
            기존 데이터베이스 연결
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-base text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            닫기
          </button>
        </div>
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(e) => {
            onQueryChange(e.target.value);
            onHighlightChange(0);
          }}
          onKeyDown={onKeyDown}
          aria-activedescendant={
            highlightIndex >= 0 ? `${listBaseId}-dialog-opt-${highlightIndex}` : undefined
          }
          placeholder="데이터베이스 검색"
          className="mb-2 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
        />
        <div
          role="listbox"
          aria-label="연결할 데이터베이스"
          className="max-h-[52vh] overflow-y-auto rounded border border-zinc-200 dark:border-zinc-700"
        >
          {candidates.length === 0 ? (
            <div className="px-3 py-2 text-base text-zinc-500">검색 결과가 없습니다.</div>
          ) : (
            candidates.map((row, idx) => (
              <button
                key={row.id}
                id={`${listBaseId}-dialog-opt-${idx}`}
                type="button"
                role="option"
                aria-selected={idx === highlightIndex}
                onMouseEnter={() => onHighlightChange(idx)}
                onClick={() => onSelect(row.id)}
                className={[
                  "block w-full px-3 py-2 text-left text-base",
                  idx === highlightIndex
                    ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                    : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800",
                ].join(" ")}
              >
                {row.meta.title}
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
