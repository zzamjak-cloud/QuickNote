import { useEffect, useMemo, useState } from "react";
import * as LucideIcons from "lucide-react";
import {
  ALL_EMOJIS,
  EMOJI_CATEGORIES,
  EMOJI_MAP,
  type EmojiCategoryId,
  type EmojiItem,
} from "./emojiData";

type Props = {
  onPick: (emoji: string) => void;
};

type CategoryFilter = EmojiCategoryId | "all";

// "전체" 카테고리는 ~1900개라 한 번에 렌더하면 패널 마운트마다 프리즈(로딩처럼 보임)가 난다.
// 초기엔 한 배치만 그리고 스크롤 시 점진 확장한다(데이터는 이미 모듈 캐시).
const GRID_BATCH = 180;

/** 사이드바 아이콘 피커 본체 — 커스텀 이모지 그리드 */
export function IconPickerEmoji({ onPick }: Props) {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>("all");

  const [limit, setLimit] = useState(GRID_BATCH);

  const visibleEmojis = useMemo<EmojiItem[]>(() => {
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      return ALL_EMOJIS.filter((e) => e.searchKey.includes(q));
    }
    if (activeCategory === "all") return ALL_EMOJIS;
    return EMOJI_MAP[activeCategory] ?? [];
  }, [query, activeCategory]);

  // 검색어·카테고리가 바뀌면 렌더 윈도우를 처음으로 되돌린다.
  useEffect(() => {
    setLimit(GRID_BATCH);
  }, [query, activeCategory]);

  const shownEmojis = visibleEmojis.slice(0, limit);

  const handleCategoryClick = (cat: CategoryFilter) => {
    setActiveCategory(cat);
    setQuery("");
  };

  return (
    <div className="flex h-full flex-col">
      {/* 검색 필드 — 루시드 탭과 동일한 스타일 */}
      <div className="mb-2 flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2 dark:border-zinc-700 dark:bg-zinc-950">
        <LucideIcons.Search size={14} className="shrink-0 text-zinc-400" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (e.target.value) setActiveCategory("all");
          }}
          placeholder="이모지 검색"
          className="h-8 min-w-0 flex-1 bg-transparent text-xs text-zinc-800 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <LucideIcons.X size={13} />
          </button>
        ) : null}
      </div>

      {/* 카테고리 탭 — 검색 중엔 숨김 */}
      {!query ? (
        <div className="mb-2 flex gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {([{ id: "all" as const, label: "전체" }] as { id: CategoryFilter; label: string }[])
            .concat(EMOJI_CATEGORIES.map((c) => ({ id: c.id, label: c.label })))
            .map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => handleCategoryClick(cat.id)}
                className={[
                  "shrink-0 rounded px-2 py-1 text-xs whitespace-nowrap",
                  activeCategory === cat.id
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700",
                ].join(" ")}
              >
                {cat.label}
              </button>
            ))}
        </div>
      ) : null}

      {/* 이모지 그리드 — 스크롤 시 점진 확장(초기 프리즈 방지) */}
      <div
        className="min-h-0 flex-1 overflow-y-auto pr-0.5"
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollHeight - el.scrollTop - el.clientHeight < 320) {
            setLimit((l) => (l < visibleEmojis.length ? l + GRID_BATCH : l));
          }
        }}
      >
        {visibleEmojis.length === 0 ? (
          <div className="py-8 text-center text-xs text-zinc-400">검색 결과가 없습니다.</div>
        ) : (
          <div className="grid grid-cols-6 gap-1">
            {shownEmojis.map((item, i) => (
              <button
                key={`${item.emoji}-${i}`}
                type="button"
                title={item.label}
                aria-label={item.label}
                onClick={() => onPick(item.emoji)}
                className="flex h-11 w-full items-center justify-center rounded text-2xl hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                {item.emoji}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
