// 플로우차트 전체보기 모달 — 읽기전용이지만 줌/패닝/Fit 으로 큰 차트를 스크롤 없이 탐색.
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import { createPortal } from "react-dom";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  ConnectionMode,
  type Node as RfNode,
  type Edge as RfEdge,
} from "@xyflow/react";
import { X } from "lucide-react";
import type { FlowchartData } from "../../types/flowchart";
import { ShapeNode } from "./ShapeNode";
import { edgeVisual, defaultEdgeOptions } from "./edges";

const nodeTypes = { shape: ShapeNode };

type Props = {
  open: boolean;
  data: FlowchartData;
  title?: string;
  onClose: () => void;
};

export function FlowchartFullViewModal({ open, data, title, onClose }: Props) {
  const rfNodes = useMemo<RfNode[]>(
    () =>
      data.nodes.map((n) => ({
        id: n.id,
        type: "shape",
        position: n.position,
        data: {
          label: n.data.label,
          shape: n.data.shape,
          color: n.data.color,
          hasLink: Boolean(n.data.link),
        },
        ...(typeof n.width === "number" ? { width: n.width } : {}),
        ...(typeof n.height === "number" ? { height: n.height } : {}),
        draggable: false,
        selectable: false,
        connectable: false,
      })),
    [data.nodes],
  );
  const rfEdges = useMemo<RfEdge[]>(
    () =>
      data.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
        ...(e.targetHandle ? { targetHandle: e.targetHandle } : {}),
        ...(e.label ? { label: e.label } : {}),
        ...edgeVisual(e.color),
        selectable: false,
      })),
    [data.edges],
  );

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center bg-black/45 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="플로우차트 전체보기"
        className="flex h-[88vh] w-[92vw] max-w-6xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2 dark:border-zinc-700">
          <span className="truncate text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            {title?.trim() ? title : "플로우차트"}
          </span>
          <button
            type="button"
            aria-label="닫기"
            onClick={onClose}
            className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 bg-zinc-50 dark:bg-zinc-900">
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            connectionMode={ConnectionMode.Loose}
            defaultEdgeOptions={defaultEdgeOptions}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            minZoom={0.05}
            maxZoom={4}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            // 읽기전용이지만 탐색을 위해 줌/패닝은 허용
            panOnDrag
            zoomOnScroll
            zoomOnPinch
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
      </div>
    </div>,
    document.body,
  );
}
