import { InputRule, Node, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

// 토글 = summary(인라인) + content(블록 다수). HTML <details>/<summary>로 표현.
export const ToggleHeader = Node.create({
  name: "toggleHeader",
  content: "inline*",
  defining: true,
  addAttributes() {
    return {
      titleLevel: {
        default: null as string | null,
        parseHTML: (el) =>
          (el as HTMLElement).getAttribute("data-title-level"),
        renderHTML: (attrs) =>
          attrs.titleLevel
            ? { "data-title-level": String(attrs.titleLevel) }
            : {},
      },
    };
  },
  parseHTML() {
    return [{ tag: "summary" }];
  },
  renderHTML({ HTMLAttributes, node }) {
    const lv = node.attrs.titleLevel as string | null;
    const titleClass =
      lv === "1"
        ? "text-3xl font-bold tracking-tight"
        : lv === "2"
          ? "text-2xl font-semibold tracking-tight"
          : lv === "3"
            ? "text-xl font-semibold"
            : "font-medium";
    return [
      "summary",
      mergeAttributes(HTMLAttributes, {
        class: `toggle-header cursor-pointer ${titleClass}`,
      }),
      0,
    ];
  },
});

export const ToggleContent = Node.create({
  name: "toggleContent",
  content: "block+",
  parseHTML() {
    return [{ tag: "div[data-toggle-content]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-toggle-content": "",
        class: "toggle-content ml-4 pl-2",
      }),
      0,
    ];
  },
});

export const Toggle = Node.create({
  name: "toggle",
  group: "block",
  content: "toggleHeader toggleContent",
  defining: true,
  draggable: true,
  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (el) =>
          (el as HTMLElement).getAttribute("open") !== null,
        renderHTML: (attrs) => (attrs.open ? { open: "" } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: "details" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "details",
      mergeAttributes(HTMLAttributes, {
        class:
          "toggle-block my-2 rounded-md border border-zinc-200 px-2 py-1 dark:border-zinc-700",
      }),
      0,
    ];
  },
  addInputRules() {
    return [
      new InputRule({
        find: /^>\s$/,
        handler: ({ chain, range }) => {
          chain().deleteRange(range).setToggle().run();
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("toggleFold"),
        props: {
          handleClick(view, pos, event) {
            const target = event.target as HTMLElement;
            if (!target.closest?.("summary.toggle-header")) return false;

            const $pos = view.state.doc.resolve(pos);
            for (let depth = $pos.depth; depth >= 0; depth--) {
              const n = $pos.node(depth);
              if (n.type.name === "toggle") {
                const nodePos = $pos.before(depth);
                event.preventDefault();
                view.dispatch(
                  view.state.tr.setNodeMarkup(nodePos, undefined, {
                    ...n.attrs,
                    open: !n.attrs.open,
                  })
                );
                return true;
              }
            }
            return false;
          },
        },
      }),
    ];
  },

  addCommands() {
    return {
      setToggle:
        () =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            content: [
              {
                type: "toggleHeader",
                content: [{ type: "text", text: "토글 제목" }],
              },
              {
                type: "toggleContent",
                content: [{ type: "paragraph" }],
              },
            ],
          }),
      setHeadingToggle:
        (level: 1 | 2 | 3) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            content: [
              {
                type: "toggleHeader",
                attrs: { titleLevel: String(level) },
                content: [
                  { type: "text", text: `제목 ${level} 토글` },
                ],
              },
              {
                type: "toggleContent",
                content: [{ type: "paragraph" }],
              },
            ],
          }),
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    toggle: {
      setToggle: () => ReturnType;
      setHeadingToggle: (level: 1 | 2 | 3) => ReturnType;
    };
  }
}
