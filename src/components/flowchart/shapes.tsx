// 플로우차트 도형 정의 — 팔레트(편집기)와 노드 렌더(ShapeNode)가 공유한다.
// 형태가 늘어나 보이지 않도록 렌더 방식을 도형별로 나눈다.
//  - box: CSS border + border-radius. 테두리 두께가 항상 균일하고 왜곡이 없다.
//  - diamond: 정사각형을 45° 회전. (clip-path 와 달리 테두리가 잘리지 않음)
//  - parallelogram: skewX. 테두리는 CSS.
//  - svg: 육각형/원통/문서. non-scaling-stroke 로 선 두께만 균일하게 유지.
import type { ReactNode } from "react";
import {
  Square,
  SquareRoundCorner,
  Circle,
  Diamond,
  RectangleHorizontal,
  Hexagon,
  Database,
  FileText,
  Pill,
} from "lucide-react";
import type { FlowchartNodeShape } from "../../types/flowchart";

export type ShapeGeometryProps = {
  fill: string;
  stroke: string;
  strokeWidth: number;
  /** preserveAspectRatio="none" 로 늘려도 선 두께를 균일하게 유지 */
  vectorEffect: "non-scaling-stroke";
};

export type ShapeKind = "box" | "parallelogram" | "svg";

type ShapeMeta = {
  shape: FlowchartNodeShape;
  label: string;
  icon: typeof Square;
  /** 텍스트 영역 여백 — 좁은 부분에서 글자가 넘치지 않게 */
  padClass: string;
  kind: ShapeKind;
  /** 노드의 고정 가로:세로 비율 — 도형이 찌그러지지 않게. 미지정 시 자유(직사각형류) */
  aspect?: number;
  /** box: border-radius CSS 값 */
  radius?: string;
  /** svg: viewBox */
  viewBox?: string;
  /** svg: 도형 본체 */
  svg?: (p: ShapeGeometryProps) => ReactNode;
};

export const FLOWCHART_SHAPES: ShapeMeta[] = [
  {
    shape: "rectangle",
    label: "사각형 (처리)",
    icon: Square,
    kind: "box",
    radius: "6px",
    padClass: "px-4 py-3",
  },
  {
    shape: "roundRectangle",
    label: "둥근 사각형",
    icon: SquareRoundCorner,
    kind: "box",
    radius: "16px",
    padClass: "px-4 py-3",
  },
  {
    shape: "terminator",
    label: "터미널 (시작/종료)",
    icon: Pill,
    kind: "box",
    radius: "9999px",
    padClass: "px-5 py-3",
  },
  {
    shape: "ellipse",
    label: "원형",
    icon: Circle,
    kind: "box",
    radius: "50%",
    aspect: 1.45,
    padClass: "px-6 py-4",
  },
  {
    shape: "diamond",
    label: "마름모 (판단)",
    icon: Diamond,
    kind: "svg",
    // 대각선이 수평·수직으로 정렬된 마름모 — 폭이 넓어져도 대칭을 유지한다.
    viewBox: "0 0 100 100",
    aspect: 1,
    padClass: "px-8 py-6",
    svg: (p) => <polygon points="50,2 98,50 50,98 2,50" {...p} />,
  },
  {
    shape: "parallelogram",
    label: "평행사변형 (입출력)",
    icon: RectangleHorizontal,
    kind: "parallelogram",
    aspect: 1.8,
    padClass: "px-7 py-3",
  },
  {
    shape: "hexagon",
    label: "육각형 (준비)",
    icon: Hexagon,
    kind: "svg",
    viewBox: "0 0 120 70",
    aspect: 120 / 70,
    padClass: "px-9 py-3",
    svg: (p) => (
      <polygon points="20,3 100,3 117,35 100,67 20,67 3,35" {...p} />
    ),
  },
  {
    shape: "cylinder",
    label: "원통 (DB)",
    icon: Database,
    kind: "svg",
    viewBox: "0 0 100 110",
    aspect: 100 / 110,
    padClass: "px-5 pb-4 pt-8",
    svg: (p) => (
      <>
        <path d="M3,14 L3,96 A47,11 0 0 0 97,96 L97,14" {...p} />
        <path d="M3,14 A47,11 0 0 0 97,14 A47,11 0 0 0 3,14 Z" {...p} />
      </>
    ),
  },
  {
    shape: "document",
    label: "문서",
    icon: FileText,
    kind: "svg",
    viewBox: "0 0 100 80",
    aspect: 100 / 80,
    padClass: "px-4 pb-8 pt-3",
    svg: (p) => (
      <path
        d="M3,4 L97,4 L97,64 C74,80 72,56 50,66 C28,76 26,54 3,70 Z"
        {...p}
      />
    ),
  },
];

const byShape = new Map(FLOWCHART_SHAPES.map((s) => [s.shape, s]));

export function getShapeMeta(shape: FlowchartNodeShape): ShapeMeta {
  const meta = byShape.get(shape) ?? byShape.get("rectangle");
  if (!meta) throw new Error("flowchart shapes not defined");
  return meta;
}
