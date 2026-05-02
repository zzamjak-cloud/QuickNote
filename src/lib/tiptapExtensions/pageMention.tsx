import { ReactRenderer } from "@tiptap/react";
import Mention from "@tiptap/extension-mention";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import { usePageStore } from "../../store/pageStore";

type Item = { id: string; title: string; icon: string | null };

type SuggestionProps = {
  items: Item[];
  command: (item: { id: string; label: string }) => void;
  clientRect?: (() => DOMRect | null) | null;
  query: string;
};

type RefHandle = {
  onKeyDown: (e: KeyboardEvent) => boolean;
};

const MentionList = forwardRef<RefHandle, SuggestionProps>(
  ({ items, command }, ref) => {
    const [selected, setSelected] = useState(0);
    useEffect(() => setSelected(0), [items]);
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
          if (it) command({ id: it.id, label: it.title });
          return true;
        }
        return false;
      },
    }));
    if (items.length === 0)
      return (
        <div className="rounded-md border border-zinc-200 bg-white p-2 text-xs text-zinc-500 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          페이지가 없습니다.
        </div>
      );
    return (
      <div className="max-h-64 w-56 overflow-y-auto rounded-md border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
        {items.map((it, idx) => (
          <button
            key={it.id}
            type="button"
            onMouseEnter={() => setSelected(idx)}
            onClick={() => command({ id: it.id, label: it.title })}
            className={[
              "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm",
              idx === selected
                ? "bg-zinc-100 dark:bg-zinc-800"
                : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60",
            ].join(" ")}
          >
            <span className="w-5 text-center">{it.icon ?? "📄"}</span>
            <span className="truncate">{it.title || "제목 없음"}</span>
          </button>
        ))}
      </div>
    );
  },
);
MentionList.displayName = "MentionList";

export const PageMention = Mention.configure({
  HTMLAttributes: {
    class:
      "page-mention rounded bg-zinc-100 px-1 text-zinc-900 hover:underline dark:bg-zinc-800 dark:text-zinc-100",
  },
  renderText({ node }) {
    return `@${node.attrs.label ?? node.attrs.id}`;
  },
  suggestion: {
    char: "@",
    items: ({ query }) => {
      const pages = Object.values(usePageStore.getState().pages);
      const q = query.trim().toLowerCase();
      return pages
        .filter((p) => !q || p.title.toLowerCase().includes(q))
        .slice(0, 8)
        .map((p) => ({ id: p.id, title: p.title, icon: p.icon }));
    },
    render: () => {
      let component: ReactRenderer<RefHandle, SuggestionProps> | null = null;
      let popup: TippyInstance[] = [];
      return {
        onStart: (props: SuggestionProps & { editor: import("@tiptap/react").Editor }) => {
          component = new ReactRenderer(MentionList, {
            props,
            editor: props.editor,
          });
          if (!props.clientRect) return;
          popup = tippy("body", {
            getReferenceClientRect: () =>
              props.clientRect?.() ?? new DOMRect(0, 0, 0, 0),
            appendTo: () => document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: "manual",
            placement: "bottom-start",
          });
        },
        onUpdate(props: SuggestionProps) {
          component?.updateProps(props);
          if (!props.clientRect) return;
          popup[0]?.setProps({
            getReferenceClientRect: () =>
              props.clientRect?.() ?? new DOMRect(0, 0, 0, 0),
          });
        },
        onKeyDown(props: { event: KeyboardEvent }) {
          if (props.event.key === "Escape") {
            popup[0]?.hide();
            return true;
          }
          return component?.ref?.onKeyDown(props.event) ?? false;
        },
        onExit() {
          popup[0]?.destroy();
          component?.destroy();
          popup = [];
          component = null;
        },
      };
    },
  },
});
