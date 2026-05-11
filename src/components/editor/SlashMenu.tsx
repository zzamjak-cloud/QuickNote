import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronLeft } from "lucide-react";
import type {
  SlashCategoryItem,
  SlashLeafItem,
  SlashMenuEntry,
} from "../../lib/tiptapExtensions/slashItems";
import { filterSlashLeaves } from "../../lib/tiptapExtensions/slashItems";

export type SlashMenuHandle = {
  onKeyDown: (e: KeyboardEvent) => boolean;
};

type Props = {
  entries: SlashMenuEntry[];
  query: string;
  command: (item: SlashLeafItem) => void;
};

function slashGroupTitle(item: SlashMenuEntry): string {
  const title = item.title;
  if (title.startsWith("DB") || title === "표") return "데이터";
  if (
    title.includes("제목") ||
    title === "본문" ||
    title.includes("목록") ||
    title === "할 일" ||
    title === "인용" ||
    title === "코드 블록" ||
    title === "구분선"
  ) {
    return "텍스트";
  }
  if (
    title === "이미지" ||
    title === "유튜브 임베드" ||
    title === "버튼" ||
    title === "페이지 링크" ||
    title === "새 페이지"
  ) {
    return "링크·미디어";
  }
  return "레이아웃";
}

export const SlashMenu = forwardRef<SlashMenuHandle, Props>(
  ({ entries, query, command }, ref) => {
    const [stack, setStack] = useState<SlashCategoryItem[]>([]);
    const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

    useEffect(() => {
      setStack([]);
    }, [query]);

    const visible = useMemo(() => {
      if (stack.length === 0) return entries;
      const cat = stack[stack.length - 1];
      if (!cat) return entries;
      return filterSlashLeaves(cat.children, query);
    }, [entries, stack, query]);

    const [selected, setSelected] = useState(0);

    useEffect(() => {
      setSelected(0);
    }, [visible, stack, query]);

    useEffect(() => {
      itemRefs.current[selected]?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
    }, [selected]);

    useImperativeHandle(ref, () => ({
      onKeyDown: (e: KeyboardEvent) => {
        if (visible.length === 0) return false;
        if (e.key === "ArrowUp") {
          setSelected((i) => (i + visible.length - 1) % visible.length);
          return true;
        }
        if (e.key === "ArrowDown") {
          setSelected((i) => (i + 1) % visible.length);
          return true;
        }
        if (e.key === "ArrowLeft") {
          if (stack.length > 0) {
            setStack((s) => s.slice(0, -1));
          }
          return true;
        }
        if (e.key === "ArrowRight") {
          const it = visible[selected];
          if (it?.kind === "category") setStack((s) => [...s, it]);
          return true;
        }
        if (e.key === "Enter") {
          const it = visible[selected];
          if (!it) return false;
          if (it.kind === "category") {
            setStack((s) => [...s, it]);
            return true;
          }
          command(it);
          return true;
        }
        return false;
      },
    }));

    if (visible.length === 0) {
      return (
        <div className="rounded-xl border border-zinc-200 bg-white p-2 text-xs text-zinc-600 shadow-xl ring-1 ring-black/5 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-white/10">
          일치하는 명령이 없습니다.
        </div>
      );
    }

    return (
      <div className="max-h-[420px] w-72 max-w-[calc(100vw-32px)] overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1 text-zinc-900 shadow-xl ring-1 ring-black/5 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-white/10">
        {stack.length > 0 && (
          <button
            type="button"
            onClick={() => setStack((s) => s.slice(0, -1))}
            className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-xs text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
          >
            <ChevronLeft size={14} />
            뒤로
          </button>
        )}
        {visible.map((item, idx) => {
          const Icon = item.icon;
          const active = idx === selected;
          const isCat = item.kind === "category";
          const groupTitle = slashGroupTitle(item);
          const prev = visible[idx - 1];
          const showGroup = !prev || slashGroupTitle(prev) !== groupTitle;
          return (
            <div key={`${item.title}-${idx}`}>
            {showGroup && idx > 0 ? (
              <div className="my-1 h-px bg-zinc-200 dark:bg-zinc-700" />
            ) : null}
            <button
              ref={(el) => {
                itemRefs.current[idx] = el;
              }}
              type="button"
              onMouseEnter={() => setSelected(idx)}
              onClick={() => {
                if (isCat) {
                  setStack((s) => [...s, item as SlashCategoryItem]);
                } else {
                  command(item as SlashLeafItem);
                }
              }}
              className={[
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                active
                  ? "bg-zinc-100 dark:bg-zinc-800"
                  : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60",
              ].join(" ")}
            >
              <Icon size={16} className="shrink-0 text-zinc-500" />
              <div className="flex-1 overflow-hidden">
                <div className="truncate text-zinc-900 dark:text-zinc-100">
                  {item.title}
                  {isCat ? (
                    <span className="ml-1 text-[10px] text-zinc-400">›</span>
                  ) : null}
                </div>
                <div className="truncate text-xs text-zinc-500">
                  {item.description}
                </div>
              </div>
            </button>
            </div>
          );
        })}
      </div>
    );
  },
);
SlashMenu.displayName = "SlashMenu";
