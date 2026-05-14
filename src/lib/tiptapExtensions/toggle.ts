import { InputRule, Node, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";

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
        class: `toggle-header ${titleClass}`,
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
        class: "toggle-block my-2 rounded-md px-2 py-1",
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

  addKeyboardShortcuts() {
    return {
      // Ctrl+Enter / Cmd+Enter: 토글 접기/열기 스위칭
      "Mod-Enter": ({ editor }) => {
        const { $from } = editor.state.selection;
        for (let depth = $from.depth; depth >= 0; depth--) {
          const node = $from.node(depth);
          if (node.type.name !== "toggle") continue;
          const pos = $from.before(depth);
          editor.view.dispatch(
            editor.state.tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              open: !node.attrs.open,
            })
          );
          return true;
        }
        return false;
      },
      "Ctrl-Enter": ({ editor }) => {
        const { $from } = editor.state.selection;
        for (let depth = $from.depth; depth >= 0; depth--) {
          const node = $from.node(depth);
          if (node.type.name !== "toggle") continue;
          const pos = $from.before(depth);
          editor.view.dispatch(
            editor.state.tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              open: !node.attrs.open,
            })
          );
          return true;
        }
        return false;
      },

      // Enter: 닫힌 toggleHeader에서만 — 동일한 빈 토글 블럭을 뒤에 추가
      "Enter": ({ editor }) => {
        const { state } = editor;
        const { $from } = state.selection;

        // toggleHeader 안에 있어야 함
        if ($from.parent.type.name !== "toggleHeader") return false;

        // 부모 toggle 노드 찾기
        let toggleNode = null as { node: ReturnType<typeof $from.node>, pos: number } | null;
        for (let depth = $from.depth; depth >= 0; depth--) {
          const node = $from.node(depth);
          if (node.type.name === "toggle") {
            toggleNode = { node, pos: $from.before(depth) };
            break;
          }
        }
        if (!toggleNode) return false;
        const { node, pos } = toggleNode;

        // 열린 토글은 기본 Enter 동작에 위임
        if (node.attrs.open) return false;

        const titleLevel = ($from.parent.attrs.titleLevel as string | null);
        const after = pos + node.nodeSize;

        const paragraphType = state.schema.nodes.paragraph;
        const toggleHeaderType = state.schema.nodes.toggleHeader;
        const toggleContentType = state.schema.nodes.toggleContent;
        const toggleType = state.schema.nodes.toggle;
        if (!paragraphType || !toggleHeaderType || !toggleContentType || !toggleType) return false;

        const newToggle = toggleType.create(
          { open: false },
          [
            toggleHeaderType.create(titleLevel ? { titleLevel } : {}, []),
            toggleContentType.create({}, [paragraphType.create()]),
          ]
        );

        const tr = state.tr.insert(after, newToggle);
        const newHeaderTextPos = after + 2;
        tr.setSelection(TextSelection.near(tr.doc.resolve(newHeaderTextPos)));
        editor.view.dispatch(tr);
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      // 토글 내부에서 Alt+Enter 시 macOS IME 한자 변환보다 먼저 이벤트 선점
      new Plugin({
        key: new PluginKey("toggleAltEnterCapture"),
        view(editorView) {
          const onKeydown = (e: KeyboardEvent) => {
            if (!e.altKey || e.key !== "Enter") return;
            const { $from } = editorView.state.selection;
            for (let d = $from.depth; d >= 0; d--) {
              if ($from.node(d).type.name === "toggle") {
                // IME 팝업만 막고 ProseMirror handleKeyDown은 계속 실행
                e.preventDefault();
                break;
              }
            }
          };
          editorView.dom.addEventListener("keydown", onKeydown, { capture: true });
          return {
            destroy() {
              editorView.dom.removeEventListener("keydown", onKeydown, { capture: true });
            },
          };
        },
      }),
      new Plugin({
        key: new PluginKey("toggleFold"),
        props: {
          handleClick(view, pos, event) {
            const target = event.target as HTMLElement;
            const summaryEl = target.closest?.("summary.toggle-header") as HTMLElement | null;
            if (!summaryEl) return false;

            // ▶ 버튼은 summary의 padding-left(18px) 영역 안에 위치
            // 그 영역 밖 클릭(텍스트 선택 등)은 토글 동작에서 제외
            const rect = summaryEl.getBoundingClientRect();
            if (event.clientX - rect.left > 18) return false;

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
