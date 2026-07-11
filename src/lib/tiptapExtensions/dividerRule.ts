import HorizontalRule from "@tiptap/extension-horizontal-rule";
import { mergeAttributes } from "@tiptap/core";

// 구분선(---) 라인 스타일 프리셋 값.
export type DividerLineStyle = "solid" | "dashed" | "dotted" | "double";
export const DIVIDER_LINE_STYLES: DividerLineStyle[] = [
  "solid",
  "dashed",
  "dotted",
  "double",
];
export const DIVIDER_THICKNESSES = [1, 2, 3, 4] as const;

// 컬러칩 프리셋 — ImageBubbleToolbar 의 OUTLINE_COLORS 와 동일한 팔레트.
export const DIVIDER_COLORS = [
  "#000000",
  "#4b5563",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#0891b2",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#ffffff",
] as const;

// 기본값 — 속성 없는 기존 문서의 hr 은 solid/기본두께/테마색을 그대로 유지(하위호환).
const DEFAULT_LINE_STYLE: DividerLineStyle = "solid";
const DEFAULT_THICKNESS = 1;

// lineStyle 이 유효한 프리셋인지 검증(잘못된 data 속성 방어).
function normalizeLineStyle(value: unknown): DividerLineStyle {
  return DIVIDER_LINE_STYLES.includes(value as DividerLineStyle)
    ? (value as DividerLineStyle)
    : DEFAULT_LINE_STYLE;
}

function normalizeThickness(value: unknown): number {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_THICKNESS;
  // 1~8px 범위로 클램프(프리셋은 1~4, 여유 폭 허용).
  return Math.min(8, Math.max(1, Math.round(n)));
}

// hr 에 라인 스타일/색/두께 속성을 추가한 구분선 확장.
// name 은 "horizontalRule" 을 그대로 유지해 기존 문서·명령과 호환된다.
export const DividerRule = HorizontalRule.extend({
  addAttributes() {
    return {
      lineStyle: {
        default: DEFAULT_LINE_STYLE,
        parseHTML: (element) => normalizeLineStyle(element.getAttribute("data-line-style")),
        renderHTML: (attrs) => ({ "data-line-style": normalizeLineStyle(attrs.lineStyle) }),
      },
      color: {
        default: null as string | null,
        parseHTML: (element) => element.getAttribute("data-color") || null,
        renderHTML: (attrs) =>
          attrs.color ? { "data-color": attrs.color as string } : {},
      },
      thickness: {
        default: DEFAULT_THICKNESS,
        parseHTML: (element) => normalizeThickness(element.getAttribute("data-thickness")),
        renderHTML: (attrs) => ({ "data-thickness": String(normalizeThickness(attrs.thickness)) }),
      },
    };
  },

  renderHTML({ HTMLAttributes }) {
    const lineStyle = normalizeLineStyle(HTMLAttributes["data-line-style"]);
    const thickness = normalizeThickness(HTMLAttributes["data-thickness"]);
    const color =
      typeof HTMLAttributes["data-color"] === "string"
        ? (HTMLAttributes["data-color"] as string)
        : null;
    // 인라인 style 로 시각 반영 — CSS 의존 없이 왕복·미리보기가 일관되게 동작.
    // color 가 없으면 border-top-color 를 지정하지 않아 테마 기본색을 상속한다.
    const style = [
      `border-top-style:${lineStyle}`,
      `border-top-width:${thickness}px`,
      color ? `border-top-color:${color}` : null,
    ]
      .filter(Boolean)
      .join(";");
    return [
      "hr",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: "qn-divider",
        style,
      }),
    ];
  },
});
