import { Node, mergeAttributes } from "@tiptap/core";

/** 단일 열: 블록 컨테이너 */
export const Column = Node.create({
  name: "column",
  group: "column",
  content: "block+",
  isolating: true,
  defining: true,
  parseHTML() {
    return [{ tag: "div[data-column]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-column": "",
        class: "column-cell min-w-0 flex-1",
      }),
      0,
    ];
  },
});

/** 2~4열: 가로 flex 그리드 */
export const ColumnLayout = Node.create({
  name: "columnLayout",
  group: "block",
  content: "column{2,4}",
  isolating: true,
  defining: true,
  addAttributes() {
    return {
      columns: {
        default: 2,
        parseHTML: (el) =>
          parseInt((el as HTMLElement).getAttribute("data-columns") ?? "2", 10),
        renderHTML: (attrs) => ({ "data-columns": String(attrs.columns) }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-column-layout]" }];
  },
  renderHTML({ HTMLAttributes, node }) {
    const n = (node.attrs.columns as number) || 2;
    const count = Math.min(4, Math.max(2, n));
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-column-layout": "",
        "data-columns": String(count),
        class: "column-layout my-2 flex min-w-0 flex-row gap-6",
      }),
      0,
    ];
  },
  addCommands() {
    return {
      setColumnLayout:
        (cols: 2 | 3 | 4) =>
        ({ commands }) => {
          const count = cols;
          const columns = Array.from({ length: count }, () => ({
            type: "column",
            content: [{ type: "paragraph" }],
          }));
          return commands.insertContent({
            type: this.name,
            attrs: { columns: count },
            content: columns,
          });
        },
    };
  },

  // 빈 컬럼은 자동 제거하지 않는다. 컬럼 수 조절은 상단 컨트롤(+/삭제)로만 수행해
  // 드래그앤드롭 중 컬럼 구조가 예기치 않게 변하는 일을 막는다.
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    columnLayout: {
      setColumnLayout: (cols: 2 | 3 | 4) => ReturnType;
    };
  }
}
