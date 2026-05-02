import { Node, mergeAttributes } from "@tiptap/core";

// 토글 = summary(인라인) + content(블록 다수). HTML <details>/<summary>로 표현.
export const ToggleHeader = Node.create({
  name: "toggleHeader",
  content: "inline*",
  defining: true,
  parseHTML() {
    return [{ tag: "summary" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "summary",
      mergeAttributes(HTMLAttributes, {
        class: "toggle-header cursor-pointer font-medium",
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
        class: "toggle-content ml-5 border-l border-zinc-200 pl-3 dark:border-zinc-700",
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
  addCommands() {
    return {
      setToggle:
        () =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            content: [
              { type: "toggleHeader", content: [{ type: "text", text: "토글 제목" }] },
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
    };
  }
}
