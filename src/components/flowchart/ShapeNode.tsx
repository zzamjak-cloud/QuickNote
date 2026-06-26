// 플로우차트 공용 도형 노드. 읽기전용 뷰어와 편집 모달이 동일하게 사용한다.
// 도형이 늘어나 보이지 않도록 kind 별로 렌더 방식을 달리한다.(shapes.tsx 참고)
// 편집 모드일 때만 4방향 연결 핸들과 인라인 텍스트 입력을 노출한다.
import { memo, useRef, useEffect, type ReactNode } from "react";
import {
  Handle,
  Position,
  useConnection,
  type NodeProps,
} from "@xyflow/react";
import { Link2 } from "lucide-react";
import type { FlowchartNodeShape } from "../../types/flowchart";
import { getShapeMeta } from "./shapes";

// React Flow 런타임 노드의 data. 직렬화 대상(FlowchartNodeData)에 편집용 콜백을 더한 형태.
export type ShapeNodeRuntimeData = {
  label: string;
  shape: FlowchartNodeShape;
  color?: string;
  editable?: boolean;
  hasLink?: boolean;
  onLabelChange?: (id: string, label: string) => void;
};

const HANDLE_POSITIONS = [
  Position.Top,
  Position.Right,
  Position.Bottom,
  Position.Left,
];

function ShapeNodeImpl({ id, data, selected }: NodeProps) {
  const d = data as ShapeNodeRuntimeData;
  const textRef = useRef<HTMLTextAreaElement>(null);
  const editable = d.editable === true;
  const meta = getShapeMeta(d.shape);

  // 연결 드래그 진행 상태 — 핸들/노드를 강조해 드롭 대상을 잘 보이게 한다.
  const connection = useConnection();
  const connecting = editable && connection.inProgress;
  const isConnectSource = connection.fromNode?.id === id;
  // 현재 포인터가 올라간 드롭 대상 노드인지
  const isConnectTarget = connection.toNode?.id === id;

  // 텍스트 높이 자동 맞춤
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [d.label, editable]);

  const fill = d.color ?? "var(--qn-flowchart-node-bg, #ffffff)";
  const stroke = selected
    ? "#0ea5e9"
    : "var(--qn-flowchart-node-stroke, #94a3b8)";
  const borderW = selected ? 2 : 1.5;
  const cssBorder = `${borderW}px solid ${stroke}`;
  // 도형별 고유 비율을 강제해 찌그러짐을 막는다. 비율 없는 도형(직사각형류)만 자유.
  const sizeClass = meta.aspect
    ? "min-w-[104px]"
    : "min-h-[56px] min-w-[112px]";
  const aspectStyle = meta.aspect
    ? { aspectRatio: String(meta.aspect) }
    : undefined;

  // kind 별 도형 배경 레이어
  let shapeLayer: ReactNode = null;
  if (meta.kind === "box") {
    shapeLayer = (
      <div
        className="absolute inset-0"
        style={{ background: fill, border: cssBorder, borderRadius: meta.radius }}
      />
    );
  } else if (meta.kind === "parallelogram") {
    shapeLayer = (
      <div
        className="absolute inset-y-0 left-[8%] right-[8%]"
        style={{
          background: fill,
          border: cssBorder,
          transform: "skewX(-18deg)",
        }}
      />
    );
  } else {
    // svg: hexagon / cylinder / document
    shapeLayer = (
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox={meta.viewBox}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        {meta.svg?.({
          fill,
          stroke,
          strokeWidth: borderW,
          vectorEffect: "non-scaling-stroke",
        })}
      </svg>
    );
  }

  // 핸들 클래스 — 연결 드래그 중에는 크게+글로우, 평소엔 작게(호버 시 확대)
  const handleClass = !editable
    ? "!opacity-0 !pointer-events-none"
    : connecting
      ? "!z-20 !h-4 !w-4 !border-2 !border-white !bg-sky-500 !shadow-[0_0_0_5px_rgba(14,165,233,0.3)]"
      : "!z-10 !h-2.5 !w-2.5 !border !border-white !bg-sky-400 transition-all hover:!h-4 hover:!w-4 hover:!bg-sky-500 hover:!shadow-[0_0_0_4px_rgba(14,165,233,0.25)]";

  return (
    <div
      className={`relative flex items-center justify-center ${sizeClass} ${
        // 읽기전용 미리보기에서 링크가 있는 도형만 클릭 가능함을 커서로 표시
        d.hasLink && !editable ? "cursor-pointer" : ""
      }`}
      style={aspectStyle}
    >
      {shapeLayer}

      {/* 링크 아이콘 — 외부/내부 링크가 연결된 도형 */}
      {d.hasLink && (
        <span className="absolute -right-1.5 -top-1.5 z-[2] flex h-5 w-5 items-center justify-center rounded-full border border-white bg-sky-500 text-white shadow">
          <Link2 className="h-3 w-3" />
        </span>
      )}

      {/* 드롭 대상 강조 헤일로 — 연결 중이고 소스가 아닌 노드에 표시 */}
      {connecting && !isConnectSource && (
        <div
          className={`pointer-events-none absolute -inset-1.5 rounded-xl border-2 border-dashed transition-colors ${
            isConnectTarget
              ? "border-sky-500 bg-sky-400/15"
              : "border-sky-300/70"
          }`}
        />
      )}

      {/* 연결 핸들 */}
      {HANDLE_POSITIONS.map((pos) => (
        <Handle
          key={pos}
          id={pos}
          type="source"
          position={pos}
          isConnectable={editable}
          className={handleClass}
        />
      ))}

      {/* 텍스트 */}
      <div
        className={`relative z-[1] flex w-full items-center justify-center text-center text-sm ${meta.padClass}`}
      >
        {editable ? (
          <textarea
            ref={textRef}
            value={d.label}
            onChange={(e) => d.onLabelChange?.(id, e.target.value)}
            // nodrag/nopan: React Flow 가 입력 중 노드를 드래그/팬하지 않도록
            className="nodrag nopan w-full resize-none overflow-hidden border-0 bg-transparent text-center text-sm text-zinc-800 outline-none placeholder:text-zinc-400"
            rows={1}
            placeholder="텍스트"
          />
        ) : (
          // 편집기 textarea(w-full)와 동일한 폭/줄바꿈으로 렌더 — 노드 실측 크기가
          // 편집기와 일치해야 미리보기에서 재측정 시 위치가 어긋나거나 깜빡이지 않는다.
          <div className="w-full whitespace-pre-wrap break-words text-center text-zinc-800">
            {d.label}
          </div>
        )}
      </div>
    </div>
  );
}

export const ShapeNode = memo(ShapeNodeImpl);
