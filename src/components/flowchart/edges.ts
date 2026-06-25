// 플로우차트 엣지(화살표) 시각 속성 — 편집기와 뷰어가 공유한다.
import { MarkerType, type Edge as RfEdge } from "@xyflow/react";
import type { FlowchartEdge } from "../../types/flowchart";

export const DEFAULT_EDGE_COLOR = "#64748b";

// 색상에 맞춘 엣지 시각 속성(선·화살표·라벨)
export function edgeVisual(color?: string) {
  const stroke = color ?? DEFAULT_EDGE_COLOR;
  return {
    style: { stroke, strokeWidth: 2 },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: stroke,
      width: 18,
      height: 18,
    },
    labelStyle: { fill: stroke, fontWeight: 600 },
    labelBgStyle: { fill: "#ffffff", fillOpacity: 0.85 },
    labelBgPadding: [6, 3] as [number, number],
    labelBgBorderRadius: 4,
  };
}

export const defaultEdgeOptions = edgeVisual(undefined);

// FlowchartEdge → React Flow 엣지(시각 속성·색상 데이터 포함)
export function rfEdgeFromData(e: FlowchartEdge): RfEdge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
    ...(e.targetHandle ? { targetHandle: e.targetHandle } : {}),
    ...(e.label ? { label: e.label } : {}),
    ...edgeVisual(e.color),
    data: { color: e.color },
  };
}
