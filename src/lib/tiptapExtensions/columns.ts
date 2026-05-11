import { Node, mergeAttributes } from "@tiptap/core";
import {
  CALLOUT_PRESET_MAP,
  type CalloutPresetId,
} from "./calloutPresets";

const COLUMN_PRESET_STYLES: Record<
  CalloutPresetId,
  { background: string; borderColor: string }
> = {
  empty: {
    background: "transparent",
    borderColor: "rgba(161, 161, 170, 0.32)",
  },
  info: {
    background: "rgba(240, 249, 255, 0.95)",
    borderColor: "rgba(125, 211, 252, 0.85)",
  },
  warning: {
    background: "rgba(255, 251, 235, 0.95)",
    borderColor: "rgba(252, 211, 77, 0.85)",
  },
  danger: {
    background: "rgba(254, 242, 242, 0.95)",
    borderColor: "rgba(252, 165, 165, 0.85)",
  },
  idea: {
    background: "rgba(254, 252, 232, 0.95)",
    borderColor: "rgba(253, 224, 71, 0.85)",
  },
  success: {
    background: "rgba(236, 253, 245, 0.95)",
    borderColor: "rgba(110, 231, 183, 0.85)",
  },
  note: {
    background: "rgba(245, 243, 255, 0.95)",
    borderColor: "rgba(196, 181, 253, 0.85)",
  },
  tip: {
    background: "rgba(238, 242, 255, 0.95)",
    borderColor: "rgba(165, 180, 252, 0.85)",
  },
};

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
    const presetStyle = COLUMN_PRESET_STYLES[presetId] ?? COLUMN_PRESET_STYLES.empty;
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-column-layout": "",
        "data-columns": String(count),
        style: `background: ${presetStyle.background}; border-color: ${presetStyle.borderColor};`,
        class: [
          "column-layout my-2 flex min-w-0 flex-row gap-6 rounded-md p-2",
          preset.frameClass,
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
