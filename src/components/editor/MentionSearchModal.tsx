// @ 입력 시 인라인 제안 대신 검색 모달로 멘션 대상 선택

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { Editor } from "@tiptap/react";
import {
  loadMergedMentionItems,
  type MentionListItem,
} from "../../lib/comments/mentionItems";

type Range = { from: number; to: number };

type Props = {
  open: boolean;
  onClose: () => void;
  editor: Editor | null;
  range: Range | null;
};

export function MentionSearchModal({ open, onClose, editor, range }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<MentionListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void loadMergedMentionItems(query, 24).then((rows) => {
      if (!cancelled) {
        setItems(rows);
        setLoading(false);
        setSelected(0);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, query]);

  const insert = useCallback(
    (item: MentionListItem) => {
      if (!editor || editor.isDestroyed || !range) {
        onClose();
        return;
      }
      editor
        .chain()
        .focus()
        .insertContentAt(
          { from: range.from, to: range.to },
          [
            {
              type: "mention",
              attrs: {
                id: item.id,
                label: item.label,
                mentionKind: item.mentionKind,
                subtitle: item.subtitle,
              },
            },
            { type: "text", text: " " },
          ],
        )
        .run();
      onClose();
    },
    [editor, range, onClose],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (items.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((i) => (i + 1) % items.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((i) => (i + items.length - 1) % items.length);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const it = items[selected];
        if (it) insert(it);
      }
    },
    [items, selected, insert, onClose],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qn-mention-search-title"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div
        className="flex w-full max-w-md flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-3 shadow-xl ring-1 ring-black/5 dark:border-zinc-600 dark:bg-zinc-900 dark:ring-white/10"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="qn-mention-search-title" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          멘션할 대상 검색
        </h2>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="이름 또는 페이지 제목…"
          className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-emerald-500/30 placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-2 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-emerald-400"
        />
        <div className="max-h-64 overflow-y-auto rounded-lg border border-zinc-100 dark:border-zinc-700">
          {loading ? (
            <div className="px-3 py-6 text-center text-xs text-zinc-500">불러오는 중…</div>
          ) : items.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-zinc-500">
              일치하는 항목이 없습니다.
            </div>
          ) : (
            items.map((it, idx) => (
              <button
                key={`${it.id}-${idx}`}
                type="button"
                onMouseEnter={() => setSelected(idx)}
                onClick={() => insert(it)}
                className={[
                  "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm",
                  idx === selected
                    ? "bg-zinc-100 dark:bg-zinc-800"
                    : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60",
                ].join(" ")}
              >
                <span className="min-w-0 truncate font-medium text-zinc-900 dark:text-zinc-100">
                  {it.label}
                </span>
                <span className="shrink-0 text-[10px] text-zinc-500">{it.subtitle}</span>
              </button>
            ))
          )}
        </div>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          ↑↓ 선택 · Enter 삽입 · Esc 닫기
        </p>
      </div>
    </div>
  );
}
