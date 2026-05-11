import { Node, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

function todayValue(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDateLabel(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value || todayValue();
  return `${m[1]}. ${m[2]}. ${m[3]}`;
}

export const DateInline = Node.create({
  name: "dateInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      value: {
        default: todayValue(),
        parseHTML: (el) =>
          (el as HTMLElement).getAttribute("data-date-value") ?? todayValue(),
        renderHTML: (attrs) => ({
          "data-date-value": String(attrs.value ?? todayValue()),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-date-inline]" }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-date-inline": "",
        class:
          "inline-flex cursor-pointer select-none items-center rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[0.85em] font-medium text-blue-800 dark:border-blue-900/70 dark:bg-blue-950/40 dark:text-blue-200",
        title: "클릭하여 날짜 변경",
      }),
      formatDateLabel(String(node.attrs.value ?? todayValue())),
    ];
  },

  addCommands() {
    return {
      insertDateInline:
        (value?: string) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { value: value || todayValue() },
          }),
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("quicknote-date-inline-click"),
        props: {
          handleClickOn: (view, pos, node) => {
            if (node.type.name !== this.name) return false;
            const current = String(node.attrs.value ?? todayValue());
            const next = window.prompt("날짜를 입력하세요 (YYYY-MM-DD)", current);
            if (next == null) return true;
            const trimmed = next.trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return true;
            view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { value: trimmed }));
            return true;
          },
        },
      }),
    ];
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    dateInline: {
      insertDateInline: (value?: string) => ReturnType;
    };
  }
}
