// 플로우차트 버전 히스토리 다이얼로그 — 기존 DB 히스토리 UX 와 통일.
// 좌측: 선택 버전 미리보기 / 우측(300px): 버전 목록 + 복원. 서버 권위(로컬 fallback).
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  ReactFlow,
  Background,
  ConnectionMode,
  type Node as RfNode,
  type Edge as RfEdge,
} from "@xyflow/react";
import { X } from "lucide-react";
import type { FlowchartData } from "../../types/flowchart";
import {
  useFlowchartHistoryStore,
  type FlowchartVersion,
} from "../../store/flowchartHistoryStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { listFlowchartHistoryApi } from "../../lib/sync/flowchartApi";
import { ShapeNode } from "./ShapeNode";
import { edgeVisual, defaultEdgeOptions } from "./edges";

const nodeTypes = { shape: ShapeNode };

function formatTime(ms: number): string {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "";
  }
}

function toRfNodes(data: FlowchartData): RfNode[] {
  return data.nodes.map((n) => ({
    id: n.id,
    type: "shape",
    position: n.position,
    data: { label: n.data.label, shape: n.data.shape, color: n.data.color },
    ...(typeof n.width === "number" ? { width: n.width } : {}),
    ...(typeof n.height === "number" ? { height: n.height } : {}),
    draggable: false,
    selectable: false,
    connectable: false,
  }));
}
function toRfEdges(data: FlowchartData): RfEdge[] {
  return data.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
    ...(e.targetHandle ? { targetHandle: e.targetHandle } : {}),
    ...(e.label ? { label: e.label } : {}),
    ...edgeVisual(e.color),
    selectable: false,
  }));
}

type Props = {
  open: boolean;
  flowchartId: string;
  editable: boolean;
  onRestore: (data: FlowchartData) => void;
  onClose: () => void;
};

export function FlowchartHistoryDialog({
  open,
  flowchartId,
  editable,
  onRestore,
  onClose,
}: Props) {
  const localVersions = useFlowchartHistoryStore((s) =>
    flowchartId ? s.versions[flowchartId] : undefined,
  );
  const [serverVersions, setServerVersions] = useState<
    FlowchartVersion[] | null
  >(null);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // 열릴 때 서버 히스토리를 불러온다(권위). 실패/미배포면 로컬 fallback.
  useEffect(() => {
    if (!open || !flowchartId) return;
    const wsId = useWorkspaceStore.getState().currentWorkspaceId;
    setSelectedIndex(0);
    setServerVersions(null);
    if (!wsId) return;
    let cancelled = false;
    setLoading(true);
    void listFlowchartHistoryApi(flowchartId, wsId).then((rows) => {
      if (cancelled) return;
      setServerVersions(rows);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, flowchartId]);

  const list = useMemo<FlowchartVersion[]>(
    () => serverVersions ?? localVersions ?? [],
    [serverVersions, localVersions],
  );
  const selected = list[Math.min(selectedIndex, Math.max(0, list.length - 1))];

  const rfNodes = useMemo<RfNode[]>(
    () => (selected ? toRfNodes(selected.data) : []),
    [selected],
  );
  const rfEdges = useMemo<RfEdge[]>(
    () => (selected ? toRfEdges(selected.data) : []),
    [selected],
  );

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[510] flex items-center justify-center bg-black/45 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="플로우차트 버전 히스토리"
        className="flex h-[84vh] w-[88vw] max-w-5xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            플로우차트 버전 히스토리
          </h2>
          <button
            type="button"
            aria-label="닫기"
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_300px] overflow-hidden">
          {/* 좌측: 선택 버전 미리보기 */}
          <div className="min-w-0 bg-zinc-50 dark:bg-zinc-900">
            {selected ? (
              <ReactFlow
                key={selected.id}
                nodes={rfNodes}
                edges={rfEdges}
                nodeTypes={nodeTypes}
                connectionMode={ConnectionMode.Loose}
                defaultEdgeOptions={defaultEdgeOptions}
                fitView
                fitViewOptions={{ padding: 0.15 }}
                minZoom={0.05}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                panOnDrag={false}
                zoomOnScroll={false}
                zoomOnDoubleClick={false}
                proOptions={{ hideAttribution: true }}
              >
                <Background />
              </ReactFlow>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-zinc-400">
                {loading ? "불러오는 중..." : "저장된 버전이 없습니다."}
              </div>
            )}
          </div>

          {/* 우측: 버전 목록 + 복원 */}
          <div className="flex min-h-0 flex-col border-l border-zinc-200 dark:border-zinc-800">
            <div className="min-h-0 flex-1 overflow-y-auto">
              {list.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-zinc-400">
                  {loading ? "불러오는 중..." : "저장된 버전이 없습니다."}
                </div>
              ) : (
                list.map((v, i) => {
                  const versionNum = list.length - i;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setSelectedIndex(i)}
                      className={`flex w-full items-start justify-between gap-2 border-b border-zinc-100 px-3 py-2 text-left dark:border-zinc-800 ${
                        i === selectedIndex
                          ? "bg-sky-50 dark:bg-sky-950/50"
                          : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
                          버전 {versionNum}
                          {i === 0 && (
                            <span className="ml-1 text-[10px] text-sky-600">
                              최신
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          노드 {v.data.nodes.length} · 엣지 {v.data.edges.length}
                        </div>
                      </div>
                      <span className="shrink-0 text-right text-[10px] leading-tight text-zinc-400">
                        {formatTime(v.createdAt)}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            <div className="flex items-center justify-end border-t border-zinc-200 p-3 dark:border-zinc-800">
              <button
                type="button"
                disabled={!selected || !editable}
                onClick={() => {
                  if (selected) onRestore(selected.data);
                }}
                className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-40"
                title={editable ? undefined : "편집 가능한 문서에서만 복원할 수 있습니다"}
              >
                이 버전으로 복원
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
