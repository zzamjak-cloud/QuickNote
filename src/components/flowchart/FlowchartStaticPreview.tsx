// 읽기전용 미리보기 — React Flow 대신 정적 SVG 로 렌더.
// SVG viewBox 가 브라우저 네이티브로 즉시 스케일하므로 측정·재계산·깜빡임이 없다.
import { useMemo } from "react";
import {
  getFlowchartBounds,
  type FlowchartData,
  type FlowchartNode,
  type FlowchartNodeShape,
  type FlowchartNodeLink,
} from "../../types/flowchart";

const DEFAULT_EDGE_COLOR = "#64748b";

type Box = { x: number; y: number; w: number; h: number };
type Side = "top" | "right" | "bottom" | "left";

function nodeBox(n: FlowchartNode): Box {
  const isDiamond = n.data.shape === "diamond";
  const w = n.width ?? (isDiamond ? 96 : 120);
  const h = n.height ?? (isDiamond ? 96 : 60);
  return { x: n.position.x, y: n.position.y, w, h };
}

// 도형 외곽선(노드 로컬 좌표 0..w, 0..h). stroke 는 viewBox 와 함께 비례 스케일.
function shapeOutline(
  shape: FlowchartNodeShape,
  w: number,
  h: number,
  fill: string,
  stroke: string,
) {
  const sw = 1.5;
  const common = { fill, stroke, strokeWidth: sw };
  switch (shape) {
    case "roundRectangle":
      return <rect x={1} y={1} width={w - 2} height={h - 2} rx={14} {...common} />;
    case "terminator":
      return (
        <rect x={1} y={1} width={w - 2} height={h - 2} rx={h / 2} {...common} />
      );
    case "ellipse":
      return (
        <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - 1} ry={h / 2 - 1} {...common} />
      );
    case "diamond":
      return (
        <polygon
          points={`${w / 2},1 ${w - 1},${h / 2} ${w / 2},${h - 1} 1,${h / 2}`}
          {...common}
        />
      );
    case "parallelogram":
      return (
        <polygon
          points={`${w * 0.22},1 ${w - 1},1 ${w * 0.78},${h - 1} 1,${h - 1}`}
          {...common}
        />
      );
    case "hexagon":
      return (
        <polygon
          points={`${w * 0.2},1 ${w * 0.8},1 ${w - 1},${h / 2} ${w * 0.8},${h - 1} ${w * 0.2},${h - 1} 1,${h / 2}`}
          {...common}
        />
      );
    case "cylinder": {
      const ry = Math.min(h * 0.14, 12);
      return (
        <g {...common}>
          <path
            d={`M1,${ry} L1,${h - ry} A ${w / 2 - 1} ${ry} 0 0 0 ${w - 1} ${h - ry} L${w - 1},${ry}`}
          />
          <path d={`M1,${ry} A ${w / 2 - 1} ${ry} 0 0 0 ${w - 1} ${ry} A ${w / 2 - 1} ${ry} 0 0 0 1 ${ry} Z`} />
        </g>
      );
    }
    case "document":
      return (
        <path
          d={`M1,1 L${w - 1},1 L${w - 1},${h - 8} C ${w * 0.72},${h + 4} ${w * 0.7},${h - 14} ${w / 2},${h - 6} C ${w * 0.3},${h + 2} ${w * 0.28},${h - 14} 1,${h - 2} Z`}
          {...common}
        />
      );
    case "rectangle":
    default:
      return <rect x={1} y={1} width={w - 2} height={h - 2} rx={6} {...common} />;
  }
}

function sidePoint(b: Box, side: Side): { x: number; y: number } {
  switch (side) {
    case "top":
      return { x: b.x + b.w / 2, y: b.y };
    case "bottom":
      return { x: b.x + b.w / 2, y: b.y + b.h };
    case "left":
      return { x: b.x, y: b.y + b.h / 2 };
    case "right":
      return { x: b.x + b.w, y: b.y + b.h / 2 };
  }
}

function inferSides(s: Box, t: Box): [Side, Side] {
  const dx = t.x + t.w / 2 - (s.x + s.w / 2);
  const dy = t.y + t.h / 2 - (s.y + s.h / 2);
  if (Math.abs(dy) >= Math.abs(dx))
    return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
  return dx >= 0 ? ["right", "left"] : ["left", "right"];
}

function control(
  p: { x: number; y: number },
  side: Side,
  off: number,
): { x: number; y: number } {
  switch (side) {
    case "top":
      return { x: p.x, y: p.y - off };
    case "bottom":
      return { x: p.x, y: p.y + off };
    case "left":
      return { x: p.x - off, y: p.y };
    case "right":
      return { x: p.x + off, y: p.y };
  }
}

type Props = {
  data: FlowchartData;
  onNodeLink?: (link: FlowchartNodeLink) => void;
};

export function FlowchartStaticPreview({ data, onNodeLink }: Props) {
  const model = useMemo(() => {
    const b = getFlowchartBounds(data);
    if (!b) return null;
    const boxes = new Map<string, Box>();
    for (const n of data.nodes) boxes.set(n.id, nodeBox(n));
    const pad = Math.max(b.width, b.height) * 0.06 + 12;
    const viewBox = `${b.minX - pad} ${b.minY - pad} ${b.width + pad * 2} ${b.height + pad * 2}`;
    return { boxes, viewBox };
  }, [data]);

  if (!model) return null;
  const { boxes, viewBox } = model;

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
      className="block"
    >
      <defs>
        <marker
          id="qn-flowchart-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          {/* context-stroke: 엣지 선 색을 화살표가 그대로 따른다 */}
          <path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
        </marker>
      </defs>

      {/* 엣지 */}
      {data.edges.map((e) => {
        const s = boxes.get(e.source);
        const t = boxes.get(e.target);
        if (!s || !t) return null;
        const [si, ti] = inferSides(s, t);
        const ss = (e.sourceHandle as Side) || si;
        const ts = (e.targetHandle as Side) || ti;
        const sp = sidePoint(s, ss);
        const tp = sidePoint(t, ts);
        const off = Math.max(Math.hypot(tp.x - sp.x, tp.y - sp.y) * 0.4, 30);
        const c1 = control(sp, ss, off);
        const c2 = control(tp, ts, off);
        const color = e.color ?? DEFAULT_EDGE_COLOR;
        const mid = { x: (sp.x + tp.x) / 2, y: (sp.y + tp.y) / 2 };
        return (
          <g key={e.id}>
            <path
              d={`M${sp.x},${sp.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${tp.x},${tp.y}`}
              fill="none"
              stroke={color}
              strokeWidth={2}
              markerEnd="url(#qn-flowchart-arrow)"
            />
            {e.label ? (
              <text
                x={mid.x}
                y={mid.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={12}
                fill={color}
                style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: 4 }}
              >
                {e.label}
              </text>
            ) : null}
          </g>
        );
      })}

      {/* 노드 */}
      {data.nodes.map((n) => {
        const b = boxes.get(n.id);
        if (!b) return null;
        const fill = n.data.color ?? "#ffffff";
        const link = n.data.link;
        return (
          <g
            key={n.id}
            transform={`translate(${b.x},${b.y})`}
            onClick={link && onNodeLink ? () => onNodeLink(link) : undefined}
            style={{ cursor: link && onNodeLink ? "pointer" : "default" }}
          >
            {shapeOutline(n.data.shape, b.w, b.h, fill, "#94a3b8")}
            <foreignObject x={0} y={0} width={b.w} height={b.h}>
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "6px 10px",
                  textAlign: "center",
                  fontSize: 14,
                  lineHeight: 1.25,
                  color: "#1f2937",
                  wordBreak: "break-word",
                  whiteSpace: "pre-wrap",
                  boxSizing: "border-box",
                }}
              >
                {n.data.label}
              </div>
            </foreignObject>
            {link ? (
              <g transform={`translate(${b.w - 9},${-2})`}>
                <circle r={9} fill="#0ea5e9" stroke="#fff" strokeWidth={1.5} />
                <path
                  d="M-3.2,0 a3,3 0 0 1 3,-3 h1 M3.2,0 a3,3 0 0 1 -3,3 h-1"
                  fill="none"
                  stroke="#fff"
                  strokeWidth={1.4}
                  strokeLinecap="round"
                  transform="rotate(-45)"
                />
              </g>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
