// 플로우차트 편집 모달. 좌측 도형 팔레트 + 중앙 React Flow 캔버스 + 상단 툴바.
import "@xyflow/react/dist/style.css";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ConnectionMode,
  type Connection,
  type Node as RfNode,
  type Edge as RfEdge,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import { Trash2, X } from "lucide-react";
import {
  createFlowchartId,
  serializeFlowchart,
  type FlowchartData,
  type FlowchartNode,
  type FlowchartNodeLink,
  type FlowchartNodeShape,
} from "../../types/flowchart";
import { ShapeNode, type ShapeNodeRuntimeData } from "./ShapeNode";
import { FLOWCHART_SHAPES } from "./shapes";
import { FlowchartLinkDialog } from "./FlowchartLinkDialog";
import {
  DEFAULT_EDGE_COLOR,
  defaultEdgeOptions,
  edgeVisual,
  rfEdgeFromData,
} from "./edges";

const nodeTypes = { shape: ShapeNode };

// 그리드 단위(px). 도형의 "중심"을 이 격자에 맞춰 연결 정점(핸들)이 서로 정렬되게 한다.
const GRID = 16;

// 노드 중심을 격자에 스냅한 좌상단 위치를 돌려준다.
function snapNodeCenter(n: RfNode): { x: number; y: number } {
  const w = n.measured?.width ?? (typeof n.width === "number" ? n.width : 0);
  const h = n.measured?.height ?? (typeof n.height === "number" ? n.height : 0);
  const cx = Math.round((n.position.x + w / 2) / GRID) * GRID;
  const cy = Math.round((n.position.y + h / 2) / GRID) * GRID;
  return { x: cx - w / 2, y: cy - h / 2 };
}

// 노드 배경색 프리셋 (none = 기본)
const COLOR_PRESETS: { label: string; value?: string }[] = [
  { label: "기본", value: undefined },
  { label: "노랑", value: "#fef3c7" },
  { label: "초록", value: "#d1fae5" },
  { label: "파랑", value: "#dbeafe" },
  { label: "분홍", value: "#fce7f3" },
  { label: "회색", value: "#e5e7eb" },
];

// 엣지(선) 색상 프리셋 — 선이라 진한 색을 쓴다
const EDGE_COLOR_PRESETS: { label: string; value?: string }[] = [
  { label: "기본", value: undefined },
  { label: "빨강", value: "#ef4444" },
  { label: "초록", value: "#22c55e" },
  { label: "파랑", value: "#3b82f6" },
  { label: "주황", value: "#f59e0b" },
  { label: "보라", value: "#8b5cf6" },
];

function toRfNode(n: FlowchartNode): RfNode {
  return {
    id: n.id,
    type: "shape",
    position: n.position,
    data: {
      label: n.data.label,
      shape: n.data.shape,
      color: n.data.color,
      ...(n.data.link ? { link: n.data.link } : {}),
    },
    // 편집기에서는 크기를 고정하지 않는다 — 글자 입력에 따라 노드가 자라야 한다.
    // (미리보기만 저장된 실측 크기로 고정해 핸들 위치를 편집기와 일치시킨다.)
  };
}

function fromRfNode(n: RfNode): FlowchartNode {
  const d = n.data as ShapeNodeRuntimeData & { link?: FlowchartNodeLink };
  // 미리보기 비율 계산용으로 실측 크기를 함께 저장한다.
  const w = n.measured?.width ?? n.width;
  const h = n.measured?.height ?? n.height;
  return {
    id: n.id,
    type: "shape",
    position: { x: n.position.x, y: n.position.y },
    data: {
      label: typeof d.label === "string" ? d.label : "",
      shape: d.shape,
      ...(d.color ? { color: d.color } : {}),
      ...(d.link ? { link: d.link } : {}),
    },
    ...(typeof w === "number" ? { width: w } : {}),
    ...(typeof h === "number" ? { height: h } : {}),
  };
}

type EditorProps = {
  initial: FlowchartData;
  onSave: (data: FlowchartData) => void;
  /** 자동 저장 — 모달을 닫지 않고 현재 상태만 저장 */
  onAutoSave?: (data: FlowchartData) => void;
  onClose: () => void;
};

function FlowchartEditorInner({
  initial,
  onSave,
  onAutoSave,
  onClose,
}: EditorProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<RfNode>(
    initial.nodes.map(toRfNode),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<RfEdge>(
    initial.edges.map(rfEdgeFromData),
  );
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const reactFlowId = useId();
  const { screenToFlowPosition, getViewport } = useReactFlow();

  const onConnect = useCallback(
    (conn: Connection) =>
      setEdges((eds) =>
        addEdge(
          {
            ...conn,
            id: createFlowchartId("e"),
            ...edgeVisual(undefined),
            data: {},
          },
          eds,
        ),
      ),
    [setEdges],
  );

  const onLabelChange = useCallback(
    (id: string, label: string) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, label } } : n,
        ),
      );
    },
    [setNodes],
  );

  // 편집용 콜백을 주입한 렌더 노드 (저장 상태에는 포함하지 않음)
  const rfNodes = useMemo<RfNode[]>(
    () =>
      nodes.map((n) => ({
        ...n,
        data: {
          ...n.data,
          editable: true,
          hasLink: Boolean((n.data as { link?: unknown }).link),
          onLabelChange,
        },
      })),
    [nodes, onLabelChange],
  );

  // 우클릭 컨텍스트 메뉴 / 링크 다이얼로그 상태
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    nodeId: string;
  } | null>(null);
  const [linkDialogNodeId, setLinkDialogNodeId] = useState<string | null>(null);

  const onNodeContextMenu = useCallback(
    (e: ReactMouseEvent, node: RfNode) => {
      e.preventDefault();
      setCtxMenu({ x: e.clientX, y: e.clientY, nodeId: node.id });
    },
    [],
  );

  const applyLink = useCallback(
    (nodeId: string, link: FlowchartNodeLink | null) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== nodeId) return n;
          const data = { ...n.data } as Record<string, unknown>;
          if (link) data.link = link;
          else delete data.link;
          return { ...n, data };
        }),
      );
    },
    [setNodes],
  );

  const ctxNodeLink = useMemo<FlowchartNodeLink | undefined>(() => {
    if (!ctxMenu) return undefined;
    const n = nodes.find((x) => x.id === ctxMenu.nodeId);
    return (n?.data as { link?: FlowchartNodeLink } | undefined)?.link;
  }, [ctxMenu, nodes]);

  const linkDialogInitial = useMemo<FlowchartNodeLink | undefined>(() => {
    if (!linkDialogNodeId) return undefined;
    const n = nodes.find((x) => x.id === linkDialogNodeId);
    return (n?.data as { link?: FlowchartNodeLink } | undefined)?.link;
  }, [linkDialogNodeId, nodes]);

  const addShape = useCallback(
    (shape: FlowchartNodeShape) => {
      // 캔버스 중앙 근처에 배치
      const center = screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      const node: RfNode = {
        id: createFlowchartId("n"),
        type: "shape",
        position: {
          x: center.x - 48 + (Math.random() - 0.5) * 40,
          y: center.y - 24 + (Math.random() - 0.5) * 40,
        },
        data: { label: "", shape },
      };
      setNodes((nds) => [...nds, node]);
    },
    [screenToFlowPosition, setNodes],
  );

  const onSelectionChange = useCallback((params: OnSelectionChangeParams) => {
    setSelectedNodeIds(params.nodes.map((n) => n.id));
    setSelectedEdgeIds(params.edges.map((e) => e.id));
  }, []);

  // 드래그가 끝나면 옮긴 도형들의 "중심"을 격자에 스냅 → 연결 정점이 서로 정렬된다.
  const onNodeDragStop = useCallback(
    (_e: MouseEvent | TouchEvent, _node: RfNode, dragged: RfNode[]) => {
      const ids = new Set(
        (dragged && dragged.length > 0 ? dragged : [_node]).map((d) => d.id),
      );
      setNodes((nds) =>
        nds.map((n) =>
          ids.has(n.id) ? { ...n, position: snapNodeCenter(n) } : n,
        ),
      );
    },
    [setNodes],
  );

  const applyColor = useCallback(
    (color?: string) => {
      if (selectedNodeIds.length === 0) return;
      const sel = new Set(selectedNodeIds);
      setNodes((nds) =>
        nds.map((n) =>
          sel.has(n.id) ? { ...n, data: { ...n.data, color } } : n,
        ),
      );
    },
    [selectedNodeIds, setNodes],
  );

  const applyEdgeColor = useCallback(
    (color?: string) => {
      if (selectedEdgeIds.length === 0) return;
      const sel = new Set(selectedEdgeIds);
      setEdges((eds) =>
        eds.map((e) =>
          sel.has(e.id)
            ? { ...e, ...edgeVisual(color), data: { ...e.data, color } }
            : e,
        ),
      );
    },
    [selectedEdgeIds, setEdges],
  );

  const setEdgeLabel = useCallback(
    (label: string) => {
      if (selectedEdgeIds.length === 0) return;
      const sel = new Set(selectedEdgeIds);
      setEdges((eds) =>
        eds.map((e) => (sel.has(e.id) ? { ...e, label } : e)),
      );
    },
    [selectedEdgeIds, setEdges],
  );

  const deleteSelected = useCallback(() => {
    const nodeSel = new Set(selectedNodeIds);
    const edgeSel = new Set(selectedEdgeIds);
    if (nodeSel.size === 0 && edgeSel.size === 0) return;
    setNodes((nds) => nds.filter((n) => !nodeSel.has(n.id)));
    setEdges((eds) =>
      eds.filter(
        (e) =>
          !edgeSel.has(e.id) &&
          !nodeSel.has(e.source) &&
          !nodeSel.has(e.target),
      ),
    );
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
  }, [selectedNodeIds, selectedEdgeIds, setNodes, setEdges]);

  const buildData = useCallback((): FlowchartData => {
    return {
      version: initial.version,
      nodes: nodes.map(fromRfNode),
      edges: edges.map((e) => {
        const color = (e.data as { color?: string } | undefined)?.color;
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
          ...(e.targetHandle ? { targetHandle: e.targetHandle } : {}),
          ...(typeof e.label === "string" && e.label ? { label: e.label } : {}),
          ...(color ? { color } : {}),
        };
      }),
      viewport: getViewport(),
    };
  }, [initial.version, nodes, edges, getViewport]);

  // 마지막으로 저장(또는 자동저장)한 직렬화 스냅샷 — 변화 없으면 자동저장을 건너뛴다.
  const lastSavedRef = useRef<string>(serializeFlowchart(initial));

  const handleSave = useCallback(() => {
    const data = buildData();
    lastSavedRef.current = serializeFlowchart(data);
    onSave(data);
  }, [buildData, onSave]);

  // 60초 주기 자동 저장 — 사용자가 저장을 깜빡해도 작업 내용을 잃지 않도록.
  // 최신 상태는 ref 로 참조해, 인터벌을 매 변경마다 재생성하지 않는다.
  const buildDataRef = useRef(buildData);
  buildDataRef.current = buildData;
  const onAutoSaveRef = useRef(onAutoSave);
  onAutoSaveRef.current = onAutoSave;
  useEffect(() => {
    const timer = window.setInterval(() => {
      const data = buildDataRef.current();
      const serialized = serializeFlowchart(data);
      if (serialized === lastSavedRef.current) return; // 변경 없음 → 스킵
      lastSavedRef.current = serialized;
      onAutoSaveRef.current?.(data);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const hasNodeSelection = selectedNodeIds.length > 0;
  const hasEdgeSelection = selectedEdgeIds.length > 0;
  // 라벨 입력칸에 보여줄 현재 선택 엣지의 라벨
  const selectedEdgeLabel = useMemo(() => {
    if (selectedEdgeIds.length === 0) return "";
    const first = edges.find((e) => e.id === selectedEdgeIds[0]);
    return typeof first?.label === "string" ? first.label : "";
  }, [selectedEdgeIds, edges]);

  return (
    <div className="flex h-full w-full flex-col bg-white dark:bg-zinc-900">
      {/* 상단 툴바 */}
      <div className="flex items-center gap-3 border-b border-zinc-200 px-4 py-2 dark:border-zinc-700">
        <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
          플로우차트 편집
        </span>

        {/* 노드 선택 시: 배경색 */}
        {hasNodeSelection && (
          <div className="ml-2 flex items-center gap-1.5">
            <span className="text-xs text-zinc-500">도형색</span>
            {COLOR_PRESETS.map((c) => (
              <button
                key={c.label}
                type="button"
                title={c.label}
                onClick={() => applyColor(c.value)}
                className="h-6 w-6 rounded-full border border-zinc-300 dark:border-zinc-600"
                style={{ background: c.value ?? "#ffffff" }}
              />
            ))}
          </div>
        )}

        {/* 엣지 선택 시: 라벨 + 선 색상 */}
        {hasEdgeSelection && (
          <div className="ml-2 flex items-center gap-1.5">
            <input
              type="text"
              value={selectedEdgeLabel}
              onChange={(e) => setEdgeLabel(e.target.value)}
              placeholder="화살표 텍스트 (예: 성공)"
              className="w-40 rounded-md border border-zinc-300 px-2 py-1 text-sm text-zinc-800 outline-none focus:border-sky-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            />
            <span className="ml-1 text-xs text-zinc-500">선색</span>
            {EDGE_COLOR_PRESETS.map((c) => (
              <button
                key={c.label}
                type="button"
                title={c.label}
                onClick={() => applyEdgeColor(c.value)}
                className="h-6 w-6 rounded-full border border-zinc-300 dark:border-zinc-600"
                style={{ background: c.value ?? DEFAULT_EDGE_COLOR }}
              />
            ))}
          </div>
        )}

        <button
          type="button"
          disabled={!hasNodeSelection && !hasEdgeSelection}
          onClick={deleteSelected}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-red-950"
        >
          <Trash2 className="h-4 w-4" /> 삭제
        </button>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="rounded-md bg-sky-600 px-3 py-1 text-sm font-medium text-white hover:bg-sky-700"
          >
            저장
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 좌측 도형 팔레트 */}
        <div className="flex w-44 flex-col gap-1.5 overflow-y-auto border-r border-zinc-200 p-3 dark:border-zinc-700">
          <span className="px-1 text-xs font-medium text-zinc-500">도형</span>
          {FLOWCHART_SHAPES.map(({ shape, label, icon: Icon }) => (
            <button
              key={shape}
              type="button"
              onClick={() => addShape(shape)}
              className="flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <Icon className="h-4 w-4 shrink-0" />{" "}
              <span className="truncate">{label}</span>
            </button>
          ))}
          <p className="mt-2 px-1 text-[11px] leading-relaxed text-zinc-400">
            도형 테두리에서 끌어 다른 도형에 연결하세요. 글자는 클릭 후 바로
            입력합니다.
          </p>
        </div>

        {/* 중앙 캔버스 */}
        <div className="min-w-0 flex-1">
          <ReactFlow
            id={reactFlowId}
            nodes={rfNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelectionChange={onSelectionChange}
            onNodeContextMenu={onNodeContextMenu}
            onNodeDragStop={onNodeDragStop}
            onPaneClick={() => setCtxMenu(null)}
            connectionMode={ConnectionMode.Loose}
            // 드롭 판정 반경을 넉넉히 — 핸들에 정확히 맞추지 않아도 가까운 핸들에 연결
            connectionRadius={48}
            connectionLineStyle={{ stroke: "#0ea5e9", strokeWidth: 2 }}
            defaultEdgeOptions={defaultEdgeOptions}
            defaultViewport={initial.viewport}
            fitView={!initial.viewport}
            deleteKeyCode={["Backspace", "Delete"]}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={16} />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
      </div>

      {/* 도형 우클릭 컨텍스트 메뉴 */}
      {ctxMenu &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-[505]"
              onMouseDown={() => setCtxMenu(null)}
              onContextMenu={(e) => {
                e.preventDefault();
                setCtxMenu(null);
              }}
            />
            <div
              className="fixed z-[506] min-w-36 overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-800"
              style={{ left: ctxMenu.x, top: ctxMenu.y }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-700"
                onClick={() => {
                  setLinkDialogNodeId(ctxMenu.nodeId);
                  setCtxMenu(null);
                }}
              >
                {ctxNodeLink ? "링크 편집" : "링크 추가"}
              </button>
              {ctxNodeLink && (
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                  onClick={() => {
                    applyLink(ctxMenu.nodeId, null);
                    setCtxMenu(null);
                  }}
                >
                  링크 제거
                </button>
              )}
            </div>
          </>,
          document.body,
        )}

      {/* 링크 편집 다이얼로그 */}
      <FlowchartLinkDialog
        open={linkDialogNodeId !== null}
        initialLink={linkDialogInitial}
        onSave={(link) => {
          if (linkDialogNodeId) applyLink(linkDialogNodeId, link);
          setLinkDialogNodeId(null);
        }}
        onClose={() => setLinkDialogNodeId(null)}
      />
    </div>
  );
}

type ModalProps = {
  open: boolean;
  initial: FlowchartData;
  onSave: (data: FlowchartData) => void;
  onAutoSave?: (data: FlowchartData) => void;
  onClose: () => void;
};

export function FlowchartEditorModal({
  open,
  initial,
  onSave,
  onAutoSave,
  onClose,
}: ModalProps) {
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
        aria-label="플로우차트 편집기"
        className="h-[85vh] w-[90vw] max-w-6xl overflow-hidden rounded-xl border border-zinc-200 shadow-2xl dark:border-zinc-700"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <ReactFlowProvider>
          <FlowchartEditorInner
            initial={initial}
            onSave={onSave}
            onAutoSave={onAutoSave}
            onClose={onClose}
          />
        </ReactFlowProvider>
      </div>
    </div>,
    document.body,
  );
}
