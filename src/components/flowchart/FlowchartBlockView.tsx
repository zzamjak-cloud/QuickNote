// 플로우차트 블록의 NodeView. 문서에서는 React Flow 를 비활성(읽기전용)으로 렌더하고,
// 더블클릭하면 편집 모달을 연다. 편집 불가(editable=false) 문서에서는 모달을 열지 않는다.
import "@xyflow/react/dist/style.css";
import {
  useId,
  useMemo,
  useState,
  useCallback,
  useRef,
  useEffect,
} from "react";
import {
  ReactFlow,
  Background,
  ConnectionMode,
  type Node as RfNode,
  type Edge as RfEdge,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  NodeViewWrapper,
  type NodeViewProps,
} from "@tiptap/react";
import { Workflow } from "lucide-react";
import {
  parseFlowchart,
  serializeFlowchart,
  getFlowchartBounds,
  type FlowchartData,
  type FlowchartNodeLink,
} from "../../types/flowchart";
import { ShapeNode } from "./ShapeNode";
import { FlowchartEditorModal } from "./FlowchartEditorModal";
import { edgeVisual, defaultEdgeOptions } from "./edges";
import { useOpenPageInPeek } from "../page/useOpenPageInPeek";
import { stripPagePrefix } from "../../lib/tiptapExtensions/mentionKind";

const nodeTypes = { shape: ShapeNode };

export function FlowchartBlockView(props: NodeViewProps) {
  const { node, selected, updateAttributes, editor } = props;
  const attrs = node.attrs as { data?: string; title?: string };
  const raw = attrs.data;
  const title = typeof attrs.title === "string" ? attrs.title : "";
  const data: FlowchartData = useMemo(() => parseFlowchart(raw), [raw]);
  const [editing, setEditing] = useState(false);
  const openInPeek = useOpenPageInPeek();

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
          link: n.data.link,
        },
        // 편집기에서 측정한 크기를 그대로 고정 — 핸들(연결점) 위치가 편집기와
        // 동일해져 미리보기에서 화살표 정렬이 어긋나지 않는다.
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

  const reactFlowId = useId();

  // 미리보기 클리핑 방지: 컨테이너 크기가 바뀔 때마다 전체 도형에 다시 맞춘다.
  const rfInstance = useRef<ReactFlowInstance | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const fitPreview = useCallback(() => {
    rfInstance.current?.fitView({ padding: 0.12 });
  }, []);
  useEffect(() => {
    const el = paneRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => fitPreview());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitPreview]);

  const openEditor = useCallback(() => {
    if (editor.isEditable) setEditing(true);
  }, [editor.isEditable]);

  // 미리보기에서 링크가 연결된 도형 클릭 → 외부=새 탭, 내부=피크
  const onNodeClick = useCallback(
    (_e: unknown, clicked: RfNode) => {
      const link = (clicked.data as { link?: FlowchartNodeLink }).link;
      if (!link) return;
      if (link.type === "url") {
        window.open(link.url, "_blank", "noopener,noreferrer");
      } else {
        // 과거 데이터가 "p:" 접두를 포함할 수 있어 방어적으로 제거한다.
        void openInPeek(stripPagePrefix(link.pageId));
      }
    },
    [openInPeek],
  );

  const handleSave = useCallback(
    (next: FlowchartData) => {
      updateAttributes({ data: serializeFlowchart(next) });
      setEditing(false);
    },
    [updateAttributes],
  );

  // 자동 저장 — 모달을 닫지 않고 attrs 만 갱신
  const handleAutoSave = useCallback(
    (next: FlowchartData) => {
      updateAttributes({ data: serializeFlowchart(next) });
    },
    [updateAttributes],
  );

  const isEmpty = data.nodes.length === 0;

  // 미리보기 박스를 저장된 도형 바운딩박스의 가로:세로 비율로 맞춘다.
  const stageStyle = useMemo(() => {
    const b = getFlowchartBounds(data);
    if (!b) return { height: 180 } as const;
    return {
      aspectRatio: `${b.width} / ${b.height}`,
      minHeight: 140,
      maxHeight: 600,
    } as const;
  }, [data]);

  return (
    <NodeViewWrapper
      as="div"
      data-flowchart-block="true"
      className={`group/flowchart my-2 overflow-hidden rounded-lg border ${
        selected
          ? "border-sky-400 ring-2 ring-sky-200 dark:ring-sky-900"
          : "border-zinc-200 dark:border-zinc-700"
      }`}
    >
      {/* 블록 헤더 — 제목 표시/편집 */}
      <div className="flex items-center gap-2 border-b border-zinc-200 bg-white px-3 py-1.5 dark:border-zinc-700 dark:bg-zinc-900">
        <Workflow className="h-4 w-4 shrink-0 text-zinc-400" />
        {editor.isEditable ? (
          <input
            type="text"
            value={title}
            onChange={(e) => updateAttributes({ title: e.target.value })}
            placeholder="제목 없음"
            // 평소엔 텍스트처럼, 호버/포커스 시 입력 필드로 보이게
            className="w-full rounded border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-medium text-zinc-800 outline-none placeholder:font-normal placeholder:text-zinc-400 hover:border-zinc-300 focus:border-sky-400 dark:text-zinc-100 dark:hover:border-zinc-600"
          />
        ) : (
          title && (
            <span className="px-1.5 text-sm font-medium text-zinc-800 dark:text-zinc-100">
              {title}
            </span>
          )
        )}
      </div>

      <div
        onDoubleClick={openEditor}
        className="relative w-full bg-zinc-50 dark:bg-zinc-900"
        style={stageStyle}
        role="button"
        tabIndex={0}
        title={editor.isEditable ? "더블클릭하여 편집" : undefined}
      >
        {isEmpty ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-zinc-400">
            <Workflow className="h-8 w-8" />
            <span className="text-sm">
              빈 플로우차트{editor.isEditable ? " · 더블클릭하여 편집" : ""}
            </span>
          </div>
        ) : (
          <div ref={paneRef} className="h-full w-full">
            <ReactFlow
              // raw 가 바뀌면(편집 저장) 리마운트되어 전체 도형에 다시 맞춘다.
              key={raw}
              id={reactFlowId}
              onInit={(inst) => {
                rfInstance.current = inst;
                inst.fitView({ padding: 0.12 });
              }}
              nodes={rfNodes}
              edges={rfEdges}
              nodeTypes={nodeTypes}
              onNodeClick={onNodeClick}
              // 핸들이 모두 source 타입이라, Strict 모드면 엣지 타겟 핸들을 못 찾아
              // 화살표가 통째로 사라진다. 편집기와 동일하게 Loose 로 맞춘다.
              connectionMode={ConnectionMode.Loose}
              defaultEdgeOptions={defaultEdgeOptions}
              fitView
              fitViewOptions={{ padding: 0.15 }}
              minZoom={0.05}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              panOnDrag={false}
              panOnScroll={false}
              zoomOnScroll={false}
              zoomOnPinch={false}
              zoomOnDoubleClick={false}
              preventScrolling={false}
              proOptions={{ hideAttribution: true }}
            >
              <Background />
            </ReactFlow>
          </div>
        )}
      </div>

      <FlowchartEditorModal
        open={editing}
        initial={data}
        onSave={handleSave}
        onAutoSave={handleAutoSave}
        onClose={() => setEditing(false)}
      />
    </NodeViewWrapper>
  );
}
