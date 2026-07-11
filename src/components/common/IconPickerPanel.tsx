import { Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from "react";
import * as LucideIcons from "lucide-react";
import {
  decodeLucidePageIcon,
  isImageLikePageIcon,
  LUCIDE_PAGE_ICON_PREFIX,
} from "../../lib/pageIcon";
import { PageIconDisplay } from "./PageIconDisplay";
import { type CustomIconPreset } from "../../lib/iconStorage";
import { EMOJI_SHORTCODE_GROUPS } from "../../lib/emojiShortcodes";
import { loadRecentIcons } from "../../lib/recentIconStorage";
import { loadLucideIconColor, saveLucideIconColor } from "../../lib/lucideIconColorStorage";
import {
  ALL_LUCIDE_PRESETS,
  getLucideIcon,
  LUCIDE_COLOR_PRESETS,
  LUCIDE_ICON_CATEGORIES,
  matchesLucideSearch,
} from "./lucideIconCatalog";

// 이모지 패널은 무거우므로 emoji 탭이 열릴 때만 지연 로드.
const IconPickerEmoji = lazy(() =>
  import("./IconPickerEmoji").then((m) => ({ default: m.IconPickerEmoji })),
);

// "전체" 루시드 카테고리는 ~1900개라 한 번에 렌더하면 프리즈가 난다.
// 초기엔 한 배치만 그리고 스크롤 시 점진 확장(데이터는 이미 모듈 캐시).
const LUCIDE_GRID_BATCH = 120;

export type IconPickerPanelProps = {
  title?: string;
  footer?: ReactNode;
  onPickEmoji: (emoji: string) => void;
  onPickLucide: (name: string, color: string) => void;
  onPickCustom?: (icon: string) => void;
  onRequestCustomUpload?: () => void;
  customIcons?: CustomIconPreset[];
  onDeleteCustomIcon?: (id: string) => void;
  /** 텍스트 셀처럼 유니코드 문자만 삽입 가능한 곳: 이모지·단축어 탭만 노출. */
  emojiOnly?: boolean;
};

const ICON_PICKER_MENUS = [
  { id: "unified", label: "통합" },
  { id: "lucide", label: "루시드" },
  { id: "emoji", label: "이모지" },
  { id: "custom", label: "커스텀" },
  { id: "shortcuts", label: "단축어" },
] as const;

type IconPickerMenu = (typeof ICON_PICKER_MENUS)[number]["id"];

const EMOJI_ONLY_MENU_IDS: IconPickerMenu[] = ["emoji", "shortcuts"];

export function IconPickerPanel({
  title: _title = "페이지 아이콘",
  footer,
  onPickEmoji,
  onPickLucide,
  onPickCustom,
  onRequestCustomUpload: _onRequestCustomUpload,
  customIcons = [],
  onDeleteCustomIcon,
  emojiOnly = false,
}: IconPickerPanelProps) {
  const menus = emojiOnly
    ? ICON_PICKER_MENUS.filter((m) => EMOJI_ONLY_MENU_IDS.includes(m.id))
    : ICON_PICKER_MENUS;
  const [color, setColor] = useState(() => loadLucideIconColor());
  const [colorOpen, setColorOpen] = useState(false);
  const [activeMenu, setActiveMenu] = useState<IconPickerMenu>(
    emojiOnly ? "emoji" : "unified",
  );
  const [activeLucideCategory, setActiveLucideCategory] = useState("all");
  const [lucideQuery, setLucideQuery] = useState("");
  const [lucideLimit, setLucideLimit] = useState(LUCIDE_GRID_BATCH);
  const recentIcons = loadRecentIcons();

  const activeCategory =
    LUCIDE_ICON_CATEGORIES.find((category) => category.id === activeLucideCategory) ??
    LUCIDE_ICON_CATEGORIES[0];
  const visibleLucideIcons = useMemo(() => {
    if (lucideQuery.trim()) {
      return ALL_LUCIDE_PRESETS.filter((item) => matchesLucideSearch(item, lucideQuery));
    }
    if (activeLucideCategory === "all") return ALL_LUCIDE_PRESETS;
    return activeCategory?.items ?? [];
  }, [activeCategory, activeLucideCategory, lucideQuery]);

  // 검색어·카테고리가 바뀌면 렌더 윈도우를 처음으로 되돌린다.
  useEffect(() => {
    setLucideLimit(LUCIDE_GRID_BATCH);
  }, [lucideQuery, activeLucideCategory]);

  const shownLucideIcons = visibleLucideIcons.slice(0, lucideLimit);

  const pickLucideIcon = (name: string) => onPickLucide(name, color);

  const pickRecentIcon = (icon: string) => {
    if (icon.startsWith(LUCIDE_PAGE_ICON_PREFIX)) {
      const decoded = decodeLucidePageIcon(icon);
      if (decoded) {
        onPickLucide(decoded.name, decoded.color);
        return;
      }
    }
    if (isImageLikePageIcon(icon)) {
      onPickCustom?.(icon);
      return;
    }
    onPickEmoji(icon);
  };

  const handleColorChange = (preset: string) => {
    setColor(preset);
    saveLucideIconColor(preset);
    setColorOpen(false);
  };

  return (
    <div className="w-[320px] rounded-md border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
      <div className="border-b border-zinc-200 p-2 dark:border-zinc-700">
        <div className="mb-2 flex items-center">
          {/* 좌측 스페이서 — 색상 버튼과 너비 균형 */}
          <div className="w-6 shrink-0" />
          {/* 탭 버튼 중앙 정렬 */}
          <div className="flex flex-1 justify-center">
            <div className="flex rounded-md bg-zinc-100 p-0.5 dark:bg-zinc-800">
              {menus.map((menu) => (
                <button
                  key={menu.id}
                  type="button"
                  onClick={() => { setActiveMenu(menu.id); setColorOpen(false); }}
                  className={[
                    "rounded px-2 py-1 text-xs",
                    activeMenu === menu.id
                      ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50"
                      : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100",
                  ].join(" ")}
                >
                  {menu.label}
                </button>
              ))}
            </div>
          </div>
          {/* 색상 드롭다운 버튼 — 루시드 탭에서만 표시 */}
          <div className="relative w-6 shrink-0">
            {activeMenu === "lucide" ? (
              <>
                <button
                  type="button"
                  onClick={() => setColorOpen((v) => !v)}
                  className="h-5 w-5 rounded-full border-2 border-white shadow ring-1 ring-zinc-300 dark:border-zinc-900 dark:ring-zinc-600"
                  style={{ backgroundColor: color }}
                  aria-label="색상 선택"
                  title="색상 선택"
                />
                {colorOpen ? (
                  <div className="absolute right-0 top-7 z-20 rounded-md border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
                    <div className="flex flex-wrap gap-1.5" style={{ width: 120 }}>
                      {LUCIDE_COLOR_PRESETS.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => handleColorChange(preset)}
                          className={[
                            "h-5 w-5 rounded-full border",
                            color === preset
                              ? "border-zinc-900 ring-2 ring-zinc-300 dark:border-white dark:ring-zinc-600"
                              : "border-zinc-200 dark:border-zinc-700",
                          ].join(" ")}
                          style={{ backgroundColor: preset }}
                          aria-label={`색상 ${preset}`}
                          title={preset}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
        <div className="h-[360px] overflow-hidden">
          {activeMenu === "unified" ? (
            <div className="flex h-full flex-col">
              <p className="mb-2 px-0.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                최근 항목
              </p>
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {recentIcons.length === 0 ? (
                  <div className="py-8 text-center text-xs text-zinc-400">
                    최근 사용한 아이콘이 없습니다.
                  </div>
                ) : (
                  <div className="grid grid-cols-6 gap-1">
                    {recentIcons.map((icon) => (
                      <button
                        key={icon}
                        type="button"
                        onClick={() => pickRecentIcon(icon)}
                        className="flex h-11 w-full items-center justify-center overflow-hidden rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        title="최근 아이콘"
                        aria-label="최근 아이콘"
                      >
                        <PageIconDisplay icon={icon} size="md" className="!h-9 !w-9" imgClassName="!h-9 !w-9" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {activeMenu === "lucide" ? (
            <div className="flex h-full flex-col">
              <div className="mb-2 flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2 dark:border-zinc-700 dark:bg-zinc-950">
                <LucideIcons.Search size={14} className="shrink-0 text-zinc-400" />
                <input
                  value={lucideQuery}
                  onChange={(event) => setLucideQuery(event.target.value)}
                  placeholder="아이콘 검색"
                  className="h-8 min-w-0 flex-1 bg-transparent text-xs text-zinc-800 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
                />
                {lucideQuery ? (
                  <button
                    type="button"
                    onClick={() => setLucideQuery("")}
                    className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    aria-label="검색어 지우기"
                  >
                    <LucideIcons.X size={13} />
                  </button>
                ) : null}
              </div>
              {!lucideQuery.trim() ? (
                <div className="mb-2 flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {[{ id: "all", label: "전체" }, ...LUCIDE_ICON_CATEGORIES].map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => setActiveLucideCategory(category.id)}
                      className={[
                        "shrink-0 rounded px-2 py-1 text-xs whitespace-nowrap",
                        activeLucideCategory === category.id
                          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700",
                      ].join(" ")}
                    >
                      {category.label}
                    </button>
                  ))}
                </div>
              ) : null}
              <div
                className="min-h-0 flex-1 overflow-y-auto pr-1"
                onScroll={(e) => {
                  const el = e.currentTarget;
                  if (el.scrollHeight - el.scrollTop - el.clientHeight < 320) {
                    setLucideLimit((l) =>
                      l < visibleLucideIcons.length ? l + LUCIDE_GRID_BATCH : l,
                    );
                  }
                }}
              >
                <div className="grid grid-cols-6 gap-1">
                  {shownLucideIcons.map((item) => {
                    const Icon = getLucideIcon(item.name);
                    return (
                      <button
                        key={item.name}
                        type="button"
                        onClick={() => pickLucideIcon(item.name)}
                        className="flex h-11 w-full items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        title={item.label}
                        aria-label={item.label}
                      >
                        <Icon size={24} color={color} strokeWidth={1.9} />
                      </button>
                    );
                  })}
                  {visibleLucideIcons.length === 0 ? (
                    <div className="col-span-6 py-6 text-center text-xs text-zinc-400">
                      검색 결과가 없습니다.
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {activeMenu === "emoji" ? (
            <div className="h-full">
              <Suspense fallback={<div className="py-8 text-center text-xs text-zinc-400">로딩…</div>}>
                <IconPickerEmoji onPick={onPickEmoji} />
              </Suspense>
            </div>
          ) : null}

          {activeMenu === "custom" ? (
            <div className="flex h-full flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto">
                {customIcons.length === 0 ? (
                  <div className="py-8 text-center text-xs text-zinc-400">
                    등록된 커스텀 아이콘이 없습니다.
                    <br />
                    <span className="text-zinc-300 dark:text-zinc-600">아래 이미지 업로드 버튼을 사용하세요.</span>
                  </div>
                ) : (
                  <div className="grid grid-cols-6 gap-1">
                    {customIcons.map((item) => (
                      <div key={item.id} className="group relative">
                        <button
                          type="button"
                          onClick={() => onPickCustom?.(item.src)}
                          className="relative flex h-11 w-full items-center justify-center overflow-hidden rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
                          title={item.label}
                          aria-label={item.label}
                        >
                          <PageIconDisplay icon={item.src} size="md" className="!h-9 !w-9" imgClassName="!h-9 !w-9" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteCustomIcon?.(item.id)}
                          className="absolute right-0.5 top-0.5 z-10 hidden h-4 w-4 items-center justify-center rounded-full bg-zinc-600 text-white group-hover:flex dark:bg-zinc-500"
                          title="삭제"
                          aria-label="아이콘 삭제"
                        >
                          <LucideIcons.X size={9} strokeWidth={2.5} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {activeMenu === "shortcuts" ? (
            <div className="flex h-full flex-col">
              <div className="mb-2 rounded-md bg-zinc-50 px-2 py-1.5 text-[11px] leading-4 text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">
                <span className="font-medium text-zinc-700 dark:text-zinc-200">입력 규칙</span>
                <span className="block">예: :체크 입력 후 Space</span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <div className="grid grid-cols-1 gap-1">
                  {EMOJI_SHORTCODE_GROUPS.map((entry) => (
                    <button
                      key={entry.emoji}
                      type="button"
                      onClick={() => onPickEmoji(entry.emoji)}
                      className="flex h-9 min-w-0 items-center gap-2 rounded px-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      title={entry.label}
                      aria-label={entry.label}
                    >
                      <span className="shrink-0 text-lg leading-none">{entry.emoji}</span>
                      <span className="min-w-0 truncate text-[11px] text-zinc-600 dark:text-zinc-300">
                        {entry.keywords.map((keyword, index) => (
                          <span key={keyword}>
                            {index === 0 ? null : <span className="mx-1 text-zinc-400">또는</span>}
                            <span className="font-mono">:{keyword}</span>
                          </span>
                        ))}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      {footer ? (
        <div className="flex flex-col gap-0.5 border-t border-zinc-200 p-1.5 dark:border-zinc-700">
          {footer}
        </div>
      ) : null}
    </div>
  );
}
