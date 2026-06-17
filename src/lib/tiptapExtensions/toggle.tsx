import { memo } from "react";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { InputRule, Node, mergeAttributes, type Editor, type JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { isToggleContentEmpty } from "./toggleContentEmpty";
import { getToggleNodeViewRenderKey } from "./toggleNodeViewKey";

const LIST_NODE_TYPES = new Set(["bulletList", "orderedList", "taskList"]);
const LIST_ITEM_NODE_TYPES = new Set(["listItem", "taskItem"]);

/** 커서가 속한 토글(제목 토글 포함)의 open 상태를 반전 */
function toggleFoldAtSelection(editor: Editor): boolean {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth >= 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name !== "toggle") continue;
    const pos = $from.before(depth);
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        open: !node.attrs.open,
      }),
    );
    return true;
  }
  return false;
}

function findFirstTextblock(node: PMNode): PMNode | null {
  if (node.isTextblock) return node;
  let found: PMNode | null = null;
  node.descendants((child) => {
    if (!child.isTextblock) return !found;
    found = child;
    return false;
  });
  return found;
}

function isToggleTitleEmpty(node: PMNode): boolean {
  if (node.type.name !== "toggle") return true;
  for (let i = 0; i < node.childCount; i += 1) {
    const child = node.child(i);
    if (child.type.name === "toggleHeader") return child.content.size === 0;
  }
  return true;
}

function toggleTitleContentFromSelection(editor: Editor): JSONContent[] {
  const { selection } = editor.state;
  const sourceNode = selection instanceof NodeSelection ? selection.node : selection.$from.parent;
  const textblock = findFirstTextblock(sourceNode);
  const serialized = textblock?.toJSON() as JSONContent | undefined;
  const inlineContent = serialized?.content;
  if (inlineContent && inlineContent.length > 0) return inlineContent;

  const fallbackText = sourceNode.textContent.trim();
  return fallbackText ? [{ type: "text", text: fallbackText }] : [];
}

function createToggleJson(editor: Editor): JSONContent {
  return {
    type: "toggle",
    content: [
      {
        type: "toggleHeader",
        content: toggleTitleContentFromSelection(editor),
      },
      {
        type: "toggleContent",
        content: [{ type: "paragraph" }],
      },
    ],
  };
}

function findToggleReplaceRange(editor: Editor): { from: number; to: number } | null {
  const { selection } = editor.state;
  if (!(selection instanceof NodeSelection)) return null;
  if (LIST_NODE_TYPES.has(selection.node.type.name)) {
    return { from: selection.from, to: selection.to };
  }
  if (!LIST_ITEM_NODE_TYPES.has(selection.node.type.name)) return null;

  const { $from } = selection;
  for (let depth = $from.depth; depth >= 1; depth -= 1) {
    const node = $from.node(depth);
    if (!LIST_NODE_TYPES.has(node.type.name) || node.childCount !== 1) continue;
    const from = $from.before(depth);
    return { from, to: from + node.nodeSize };
  }
  return null;
}

// 토글 = summary(인라인) + content(블록 다수). 저장/클립보드는 <details>/<summary> 유지,
// 에디터 렌더는 React NodeView(div)로 전환 — details DOM reflow 및 불필요한 리렌더 제거.

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
        "data-title-empty": node.content.size === 0 ? "true" : "false",
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

// 표시 속성이 바뀔 때만 React 컴포넌트 리렌더 — 내용 입력 시 리렌더 없음
function areToggleNodeViewsEqual(prev: NodeViewProps, next: NodeViewProps): boolean {
  return getToggleNodeViewRenderKey(prev.node) === getToggleNodeViewRenderKey(next.node);
}

const ToggleView = memo(function ToggleView({ node }: NodeViewProps) {
  const isOpen = node.attrs.open as boolean;
  const contentEmpty = isToggleContentEmpty(node);
  const titleEmpty = isToggleTitleEmpty(node);
  const backgroundColor = node.attrs.backgroundColor as string | null;
  const blockTextColor = node.attrs.blockTextColor as string | null;
  const indent = (node.attrs.indent as number) || 0;
  return (
    <NodeViewWrapper
      as="div"
      className="toggle-block my-2 rounded-md px-2 py-1"
      data-open={String(isOpen)}
      data-content-empty={contentEmpty ? "true" : "false"}
      data-title-empty={titleEmpty ? "true" : "false"}
      data-indent={indent > 0 ? String(indent) : undefined}
      data-bg-color={backgroundColor || undefined}
      data-text-color={blockTextColor || undefined}
    >
      <NodeViewContent />
    </NodeViewWrapper>
  );
}, areToggleNodeViewsEqual);

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
  // HTML 내보내기·클립보드용 — 에디터 실렌더는 addNodeView가 담당
  renderHTML({ HTMLAttributes }) {
    return [
      "details",
      mergeAttributes(HTMLAttributes, {
        class: "toggle-block my-2 rounded-md px-2 py-1",
      }),
      0,
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ToggleView);
  },
  addInputRules() {
    return [
      new InputRule({
        // `> ` 입력 시 토글 생성 — IME/nbsp 변형까지 허용
        find: /^>\s$/,
        handler: ({ state, chain }) => {
          const { $from } = state.selection;
          const paragraphStart = $from.start();
          const paragraphEnd = $from.end();
          const lineText = $from.parent.textContent.replace(/\u00a0/g, " ").trim();
          if (lineText !== ">") return;
          chain()
            .deleteRange({ from: paragraphStart, to: paragraphEnd })
            .insertContentAt(paragraphStart, {
              type: this.name,
              content: [
              {
                type: "toggleHeader",
                content: [],
              },
                {
                  type: "toggleContent",
                  content: [{ type: "paragraph" }],
                },
              ],
            })
            .run();
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      // Shift+Enter: 토글 접기/열기 (헤더·본문 모두)
      "Shift-Enter": ({ editor }) => toggleFoldAtSelection(editor),
      // Ctrl+Enter / Cmd+Enter: 동일
      "Mod-Enter": ({ editor }) => toggleFoldAtSelection(editor),
      "Ctrl-Enter": ({ editor }) => toggleFoldAtSelection(editor),
      // Enter: 닫힌 toggleHeader에서만 — 동일한 빈 토글 블럭을 뒤에 추가
      // (토글·제목 토글 헤더에서 위에 빈 블록: Alt+Enter — insertBeforeBlock.ts)
      "Enter": ({ editor }) => {
        const { state } = editor;
        const { $from } = state.selection;

        if ($from.parent.type.name !== "toggleHeader") return false;

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

        // 열린 토글에서 Enter: 토글 콘텐츠 내부 최상단에 빈 문단을 만들고 커서를 이동
        if (node.attrs.open) {
          const paragraphType = state.schema.nodes.paragraph;
          const toggleContentType = state.schema.nodes.toggleContent;
          if (!paragraphType) return false;
          if (!toggleContentType) return false;
          let contentPos: number | null = null;
          node.forEach((child, offset) => {
            if (child.type.name === "toggleContent") {
              contentPos = pos + 1 + offset;
            }
          });
          if (contentPos == null) return false;
          const contentNode = state.doc.nodeAt(contentPos);
          if (!contentNode) return false;
          const insertPos = contentPos + 1;
          const tr = state.tr.insert(insertPos, paragraphType.create());
          tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 1)));
          editor.view.dispatch(tr);
          return true;
        }

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
      new Plugin({
        key: new PluginKey("toggleFold"),
        props: {
          handleClick(view, pos, event) {
            const target = event.target as HTMLElement;
            const summaryEl = target.closest?.("summary.toggle-header") as HTMLElement | null;
            if (!summaryEl) return false;

            // ▶ 버튼은 summary의 padding-left(18px) 영역 안에 위치
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
        ({ editor, commands, tr, dispatch }) => {
          const toggleJson = createToggleJson(editor);
          const replaceRange = findToggleReplaceRange(editor);
          if (replaceRange) {
            tr.replaceWith(
              replaceRange.from,
              replaceRange.to,
              editor.schema.nodeFromJSON(toggleJson),
            );
            dispatch?.(tr);
            return true;
          }
          return commands.insertContent(toggleJson);
        },
      setHeadingToggle:
        (level: 1 | 2 | 3) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            content: [
              {
                type: "toggleHeader",
                attrs: { titleLevel: String(level) },
                content: [],
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
