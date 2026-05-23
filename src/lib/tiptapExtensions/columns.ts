import { Node, mergeAttributes } from "@tiptap/core";
import {
  CALLOUT_PRESET_MAP,
  type CalloutPresetId,
} from "./calloutPresets";

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
      preset: {
        default: "empty",
        parseHTML: (el) =>
          (el as HTMLElement).getAttribute("data-preset") ?? "empty",
        renderHTML: (attrs) => ({ "data-preset": String(attrs.preset ?? "empty") }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-column-layout]" }];
  },
  renderHTML({ HTMLAttributes, node }) {
    const n = (node.attrs.columns as number) || 2;
    const count = Math.min(4, Math.max(2, n));
    const presetId = (node.attrs.preset as CalloutPresetId) ?? "empty";
    const preset = CALLOUT_PRESET_MAP[presetId] ?? CALLOUT_PRESET_MAP.empty;
    // 컬럼 블럭 기본 외곽은 매우 연한 라운드 아웃라인을 유지한다.
    const frameClass =
      presetId === "empty"
        ? "bg-transparent shadow-none ring-0"
        : preset.frameClass;
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-column-layout": "",
        "data-columns": String(count),
        style:
          presetId !== "empty" && preset.color
            ? `background: ${preset.color}; border-color: ${preset.color};`
            : "",
        class: [
          "column-layout my-2 flex min-w-0 flex-row gap-6 rounded-md p-2",
          frameClass,
        ].join(" "),
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
      updateColumnLayoutPreset:
        (preset: CalloutPresetId) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, { preset }),
    };
  },

  // 빈 컬럼은 자동 제거하지 않는다. 컬럼 수 조절은 상단 컨트롤(+/삭제)로만 수행해
  // 드래그앤드롭 중 컬럼 구조가 예기치 않게 변하는 일을 막는다.
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    columnLayout: {
      setColumnLayout: (cols: 2 | 3 | 4) => ReturnType;
      updateColumnLayoutPreset: (preset: CalloutPresetId) => ReturnType;
    };
  }
}
