import { Node, mergeAttributes } from "@tiptap/core";

// 콜아웃 = 좌측 이모지 + 본문 paragraph 컨테이너.
// HTML 표현: <div data-callout data-emoji="💡">...</div>
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      emoji: {
        default: "💡",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-emoji") ?? "💡",
        renderHTML: (attrs) => ({ "data-emoji": attrs.emoji }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-callout": "",
        class:
          "callout relative my-3 flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900/50 dark:bg-amber-950/30",
      }),
      [
        "div",
        {
          contenteditable: "false",
          class: "callout-emoji shrink-0 select-none text-xl leading-7",
        },
        HTMLAttributes["data-emoji"] ?? "💡",
      ],
      ["div", { class: "callout-body flex-1" }, 0],
    ];
  },

  addCommands() {
    return {
      setCallout:
        (emoji = "💡") =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { emoji },
            content: [{ type: "paragraph" }],
          }),
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (emoji?: string) => ReturnType;
    };
  }
}
