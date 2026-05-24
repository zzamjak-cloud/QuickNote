import { useMemo, useState } from "react";
import * as LucideIcons from "lucide-react";
import rawEmojiData from "emoji-picker-react/dist/data/emojis.json";

type Props = {
  onPick: (emoji: string) => void;
};

type RawEmoji = { n: string[]; u: string; a: string };
type EmojiItem = { emoji: string; label: string; searchKey: string };

const CATEGORIES = [
  { id: "smileys_people", label: "표정" },
  { id: "animals_nature", label: "동물" },
  { id: "food_drink",     label: "음식" },
  { id: "activities",     label: "활동" },
  { id: "travel_places",  label: "여행" },
  { id: "objects",        label: "사물" },
  { id: "symbols",        label: "기호" },
  { id: "flags",          label: "국기" },
] as const;

type CategoryId = (typeof CATEGORIES)[number]["id"] | "all";

function toEmoji(unified: string): string {
  try {
    return String.fromCodePoint(...unified.split("-").map((h) => parseInt(h, 16)));
  } catch {
    return "";
  }
}

// 모듈 레벨에서 한 번만 파싱
function buildEmojiMap(): Record<string, EmojiItem[]> {
  const raw = (rawEmojiData as { emojis: Record<string, RawEmoji[]> }).emojis;

  return Object.fromEntries(
    CATEGORIES.map((cat) => [
      cat.id,
      (raw[cat.id] ?? [])
        .map((e) => ({
          emoji: toEmoji(e.u),
          label: e.n.at(-1) ?? e.u,
          searchKey: e.n.join(" "),
        }))
        .filter((e) => e.emoji),
    ]),
  );
}

const EMOJI_MAP = buildEmojiMap();
const ALL_EMOJIS = CATEGORIES.flatMap((cat) => EMOJI_MAP[cat.id] ?? []);

/** 사이드바 아이콘 피커 본체 — 커스텀 이모지 그리드 */
export function IconPickerEmoji({ onPick }: Props) {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<CategoryId>("all");

  const visibleEmojis = useMemo<EmojiItem[]>(() => {
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      return ALL_EMOJIS.filter((e) => e.searchKey.includes(q));
    }
    if (activeCategory === "all") return ALL_EMOJIS;
    return EMOJI_MAP[activeCategory] ?? [];
  }, [query, activeCategory]);

  const handleCategoryClick = (cat: CategoryId) => {
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
          {([{ id: "all" as const, label: "전체" }] as { id: CategoryId; label: string }[])
            .concat(CATEGORIES)
            .map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => handleCategoryClick(cat.id)}
                className={[
                  "shrink-0 rounded px-2 py-1 text-xs",
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

      {/* 이모지 그리드 */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        {visibleEmojis.length === 0 ? (
          <div className="py-8 text-center text-xs text-zinc-400">검색 결과가 없습니다.</div>
        ) : (
          <div className="grid grid-cols-6 gap-1">
            {visibleEmojis.map((item, i) => (
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
