import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import type { SlashItem } from "../../lib/tiptapExtensions/slashItems";

export type SlashMenuHandle = {
  onKeyDown: (e: KeyboardEvent) => boolean;
};

type Props = {
  items: SlashItem[];
  command: (item: SlashItem) => void;
};

export const SlashMenu = forwardRef<SlashMenuHandle, Props>(
  ({ items, command }, ref) => {
    const [selected, setSelected] = useState(0);

    useEffect(() => {
      setSelected(0);
    }, [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown: (e) => {
        if (items.length === 0) return false;
        if (e.key === "ArrowUp") {
          setSelected((i) => (i + items.length - 1) % items.length);
          return true;
        }
        if (e.key === "ArrowDown") {
          setSelected((i) => (i + 1) % items.length);
          return true;
        }
        if (e.key === "Enter") {
          const it = items[selected];
          if (it) command(it);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div className="rounded-md border border-zinc-200 bg-white p-2 text-xs text-zinc-500 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
          일치하는 명령이 없습니다.
        </div>
      );
    }

    return (
      <div className="max-h-72 w-64 overflow-y-auto rounded-md border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
        {items.map((item, idx) => {
          const Icon = item.icon;
          const active = idx === selected;
          return (
            <button
              key={item.title}
              type="button"
              onMouseEnter={() => setSelected(idx)}
              onClick={() => command(item)}
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
                </div>
                <div className="truncate text-xs text-zinc-500">
                  {item.description}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    );
  },
);
SlashMenu.displayName = "SlashMenu";
