import { Extension } from "@tiptap/core";

export type BlockBgColor =
  | "yellow"
  | "blue"
  | "gray"
  | "brown"
  | "red"
  | "orange"
  | "green"
  | "purple"
  | "pink"
  | "teal"
  | null;

export type BlockBgPreset = {
  id: BlockBgColor;
  label: string;
  lightStyle: string;
  darkStyle: string;
  dot: string;
};

export const BLOCK_BG_PRESETS: BlockBgPreset[] = [
  {
    id: "yellow",
    label: "노랑",
    lightStyle: "rgba(253,246,178,0.7)",
    darkStyle: "rgba(113,103,0,0.35)",
    dot: "#f5d020",
  },
  {
    id: "orange",
    label: "주황",
    lightStyle: "rgba(255,228,196,0.7)",
    darkStyle: "rgba(130,70,0,0.35)",
    dot: "#f4a22d",
  },
  {
    id: "red",
    label: "빨강",
    lightStyle: "rgba(255,210,210,0.65)",
    darkStyle: "rgba(120,20,20,0.35)",
    dot: "#e05252",
  },
  {
    id: "pink",
    label: "분홍",
    lightStyle: "rgba(255,215,235,0.65)",
    darkStyle: "rgba(120,30,70,0.35)",
    dot: "#e87dac",
  },
  {
    id: "purple",
    label: "보라",
    lightStyle: "rgba(230,215,255,0.65)",
    darkStyle: "rgba(80,30,130,0.35)",
    dot: "#9b5de5",
  },
  {
    id: "blue",
    label: "파랑",
    lightStyle: "rgba(210,230,255,0.65)",
    darkStyle: "rgba(20,60,130,0.35)",
    dot: "#4b8ae8",
  },
  {
    id: "teal",
    label: "청록",
    lightStyle: "rgba(200,245,240,0.65)",
    darkStyle: "rgba(10,80,70,0.35)",
    dot: "#1eb8a0",
  },
  {
    id: "green",
    label: "초록",
    lightStyle: "rgba(210,245,210,0.65)",
    darkStyle: "rgba(20,80,20,0.35)",
    dot: "#3aaa52",
  },
  {
    id: "gray",
    label: "회색",
    lightStyle: "rgba(230,230,235,0.65)",
    darkStyle: "rgba(70,70,80,0.40)",
    dot: "#a0a0b0",
  },
  {
    id: "brown",
    label: "갈색",
    lightStyle: "rgba(240,225,205,0.65)",
    darkStyle: "rgba(90,55,20,0.38)",
    dot: "#b07d4a",
  },
];

/** 텍스트 기반 블록에 backgroundColor 속성을 추가하는 GlobalAttributes 확장 */
export const BlockBackground = Extension.create({
  name: "blockBackground",

  addGlobalAttributes() {
    return [
      {
        types: [
          "paragraph",
          "heading",
          "blockquote",
          "toggle",
          "toggleHeader",
          "bulletList",
          "orderedList",
          "taskList",
          // 마크다운 형식 블록 — 개별 항목 단위로도 배경색을 적용할 수 있도록 listItem/taskItem 포함.
          "listItem",
          "taskItem",
        ],
        attributes: {
          backgroundColor: {
            default: null as string | null,
            parseHTML: (el) => (el as HTMLElement).getAttribute("data-bg-color") || null,
            renderHTML: (attrs) => {
              if (!attrs.backgroundColor) return {};
              return { "data-bg-color": attrs.backgroundColor };
            },
          },
        },
      },
    ];
  },
});
