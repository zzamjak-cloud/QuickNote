import { Node, mergeAttributes } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";

// column 자식이 비어 있거나 단일 빈 paragraph 만 남았는지 판정.
function isEmptyColumn(col: PMNode): boolean {
  if (col.content.size === 0) return true;
  if (col.childCount === 1) {
    const only = col.firstChild;
    if (only && only.type.name === "paragraph" && only.content.size === 0) {
      return true;
    }
  }
  return false;
}

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

  // 빈 column 자동 정리:
  // - 일부 column 만 비었으면 그 column 만 제거 + columns attr 갱신
  // - column 수가 1 이하로 줄어들면 columnLayout 자체를 unwrap 해 안의 컨텐츠를 layout 위치에 인라인.
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((t) => t.docChanged)) return null;
          type Hit = {
            pos: number;
            node: PMNode;
            emptyIndices: number[];
          };
          const hits: Hit[] = [];
          newState.doc.descendants((node, pos) => {
            if (node.type.name !== "columnLayout") return;
            const emptyIndices: number[] = [];
            node.forEach((col, _o, idx) => {
              if (isEmptyColumn(col)) emptyIndices.push(idx);
            });
            if (emptyIndices.length > 0) {
              hits.push({ pos, node, emptyIndices });
            }
          });
          if (hits.length === 0) return null;
          const tr = newState.tr;
          // 끝에서부터 변환해야 pos invalidation 을 피함.
          for (const { pos, node, emptyIndices } of hits.reverse()) {
            const totalCols = node.childCount;
            const remaining = totalCols - emptyIndices.length;
            if (remaining < 2) {
              // 컬럼 레이아웃 전체 unwrap — 남은 column 들의 자식들을 layout 자리에 인라인.
              const inlineChildren: PMNode[] = [];
              node.forEach((col, _o, idx) => {
                if (emptyIndices.includes(idx)) return;
                col.forEach((child) => inlineChildren.push(child));
              });
              if (inlineChildren.length === 0) {
                // 남은 게 없으면 빈 paragraph 한 개만 둠.
                const para = newState.schema.nodes.paragraph?.create();
                if (para) {
                  tr.replaceWith(pos, pos + node.nodeSize, para);
                }
              } else {
                tr.replaceWith(
                  pos,
                  pos + node.nodeSize,
                  Fragment.fromArray(inlineChildren),
                );
              }
            } else {
              // 빈 column 만 제거 + columns attr 업데이트.
              const keptCols: PMNode[] = [];
              node.forEach((col, _o, idx) => {
                if (!emptyIndices.includes(idx)) keptCols.push(col);
              });
              const newLayout = node.type.create(
                { ...node.attrs, columns: remaining },
                Fragment.fromArray(keptCols),
              );
              tr.replaceWith(pos, pos + node.nodeSize, newLayout);
            }
          }
          return tr.steps.length > 0 ? tr : null;
        },
      }),
    ];
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    columnLayout: {
      setColumnLayout: (cols: 2 | 3 | 4) => ReturnType;
    };
  }
}
