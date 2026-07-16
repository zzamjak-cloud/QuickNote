// @ 입력 시 인라인 제안 대신 검색 모달로 멘션 대상 선택 — 페이지·구성원 통합 검색

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
  rememberMentionItemTarget,
  type MentionListItem,
} from "../../lib/comments/mentionItems";
import { ensureBlockId } from "../../lib/comments/ensureBlockId";
import { useMemberStore } from "../../store/memberStore";
import { useUiStore } from "../../store/uiStore";
import { stripMemberPrefix } from "../../lib/tiptapExtensions/mentionKind";

type Range = { from: number; to: number };

type Props = {
  open: boolean;
  onClose: () => void;
  editor: Editor | null;
  range: Range | null;
};

/** 페이지·구성원 통합 멘션 후보를 검색하는 훅. */
function useMentionSearch(open: boolean, query: string) {
  const [items, setItems] = useState<MentionListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolvedQuery, setResolvedQuery] = useState("");

  useEffect(() => {
    if (!open) {
      setItems([]);
      setLoading(false);
      setResolvedQuery("");
      return;
    }
    const q = query.trim();
    if (!q) {
      setItems([]);
      setLoading(false);
      setResolvedQuery("");
      return;
    }
    let cancelled = false;
    const loadingTimer = window.setTimeout(() => {
      if (!cancelled) setLoading(true);
    }, 180);
    const apply = (rows: MentionListItem[]) => {
      if (cancelled) return;
      setItems(rows);
      setResolvedQuery(q);
    };
    void loadMergedMentionItems(query, 24, { includeRemoteMembers: false }).then((rows) => {
      window.clearTimeout(loadingTimer);
      apply(rows);
      if (!cancelled) setLoading(false);
    });
    // 멤버 캐시가 stale 하면 원격 멤버 검색까지 포함해 결과를 갱신한다(120ms 디바운스).
    const remoteTimer = window.setTimeout(() => {
      void loadMergedMentionItems(query, 24, { includeRemoteMembers: true }).then(apply);
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(loadingTimer);
      window.clearTimeout(remoteTimer);
    };
  }, [open, query]);

  return { items, loading, resolvedQuery };
}

export function MentionSearchModal({ open, onClose, editor, range }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);

  const search = useMentionSearch(open, query);
  const combined = search.items;

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  const insert = useCallback(
    (item: MentionListItem) => {
      if (!editor || editor.isDestroyed || !range) {
        onClose();
        return;
      }
      if (item.mentionKind === "member") {
        const memberId = stripMemberPrefix(item.id);
        const member = useMemberStore
          .getState()
          .members.find((m) => m.memberId === memberId && m.status === "active");
        if (!member) {
          useUiStore.getState().showToast(
            `${item.label}님은 워크스페이스 접근 권한이 없어서 멘션할 수 없습니다.`,
            { kind: "error" },
          );
          onClose();
          return;
        }
      }
      rememberMentionItemTarget(item);
      const $from = editor.state.doc.resolve(range.from);
      for (let depth = $from.depth; depth > 0; depth--) {
        if ($from.node(depth).isBlock) {
          ensureBlockId(editor, $from.before(depth));
          break;
        }
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
      if (combined.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((i) => (i + 1) % combined.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((i) => (i + combined.length - 1) % combined.length);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const it = combined[selected];
        if (it) insert(it);
      }
    },
    [combined, selected, insert, onClose],
  );

  if (!open) return null;

  const inputClass =
    "w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-emerald-500/30 placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-2 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-emerald-400";

  const anyQuery = !!query.trim();
  const anyLoading = search.loading;
  const settled = !query.trim() || search.resolvedQuery === query.trim();

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
        className="flex w-full max-w-lg flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-3 shadow-xl ring-1 ring-black/5 dark:border-zinc-600 dark:bg-zinc-900 dark:ring-white/10"
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
          placeholder="페이지 또는 구성원 검색"
          className={inputClass}
        />
        <div className="h-80 overflow-y-auto rounded-lg border border-zinc-100 dark:border-zinc-700">
          {!anyQuery ? (
            <div className="px-3 py-6 text-center text-xs text-zinc-400">검색어를 입력하세요.</div>
          ) : anyLoading && combined.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-zinc-500">불러오는 중…</div>
          ) : combined.length === 0 ? (
            settled ? (
              <div className="px-3 py-6 text-center text-xs text-zinc-500">일치하는 항목이 없습니다.</div>
            ) : null
          ) : (
            combined.map((item, index) => (
              <button
                key={`${item.id}-${index}`}
                type="button"
                onMouseEnter={() => setSelected(index)}
                onClick={() => insert(item)}
                className={[
                  "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm",
                  index === selected
                    ? "bg-blue-50 dark:bg-blue-950/50"
                    : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60",
                ].join(" ")}
              >
                <span className="min-w-0 truncate font-medium text-zinc-900 dark:text-zinc-100">
                  {item.label}
                </span>
                <span className="shrink-0 text-[10px] text-zinc-500">{item.subtitle}</span>
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
