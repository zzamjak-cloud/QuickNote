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
  addAttributes() {
    return {
      // 컬럼 너비 비율(flex-grow 값). null 이면 기본 균등(flex-1).
      // PM 이 직접 inline style 로 렌더하므로 비율 적용이 누락되지 않는다.
      width: {
        default: null,
        parseHTML: (el) => {
          const v = (el as HTMLElement).getAttribute("data-col-width");
          const n = v ? Number(v) : NaN;
          return Number.isFinite(n) && n > 0 ? n : null;
        },
        renderHTML: (attrs) =>
          attrs.width != null && attrs.width > 0
            ? {
                "data-col-width": String(attrs.width),
                style: `flex: ${attrs.width} 1 0%`,
              }
            : {},
      },
    };
  },
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

/** 2~6열: 가로 flex 그리드 */
export const ColumnLayout = Node.create({
  name: "columnLayout",
  group: "block",
  content: "column{2,6}",
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
    const count = Math.min(6, Math.max(2, n));
    const presetId = (node.attrs.preset as CalloutPresetId) ?? "empty";
    const preset = CALLOUT_PRESET_MAP[presetId] ?? CALLOUT_PRESET_MAP.empty;
    // empty=연한 아웃라인만 유지, none=아웃라인까지 숨김(CSS [data-preset="none"]).
    // 둘 다 배경색·그림자는 없다.
    const isPlain = presetId === "empty" || presetId === "none";
    const frameClass = isPlain
      ? "bg-transparent shadow-none ring-0"
      : preset.frameClass;
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-column-layout": "",
        "data-columns": String(count),
        style:
          !isPlain && preset.color
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
        (cols: 2 | 3 | 4 | 5 | 6) =>
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
        ({ state, dispatch }) => {
          // 선택된 단일 컬럼 레이아웃에만 적용한다.
          // updateAttributes 는 NodeSelection 범위 내 모든 columnLayout(중첩 포함)을
          // 갱신하므로, 중첩 컬럼의 프리셋이 함께 바뀌는 문제를 피한다.
          const pos = state.selection.from;
          const node = state.doc.nodeAt(pos);
          if (!node || node.type.name !== this.name) return false;
          if (dispatch) {
            dispatch(
              state.tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                preset,
              }),
            );
          }
          return true;
        },
    };
  },

  // 빈 컬럼은 자동 제거하지 않는다. 컬럼 수 조절은 상단 컨트롤(+/삭제)로만 수행해
  // 드래그앤드롭 중 컬럼 구조가 예기치 않게 변하는 일을 막는다.
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    columnLayout: {
      setColumnLayout: (cols: 2 | 3 | 4 | 5 | 6) => ReturnType;
      updateColumnLayoutPreset: (preset: CalloutPresetId) => ReturnType;
    };
  }
}
