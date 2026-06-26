// 플로우차트 블록 데이터 모델.
// React Flow(@xyflow/react)의 nodes/edges/viewport 를 그대로 보관하되,
// TipTap 블록 attrs 에는 항상 "JSON 문자열 한 번 인코딩" 형태로 저장한다.
// (databaseBlock.panelState 와 동일 전략 — Yjs 동기화 시 통짜 문자열 교체가 안전)

export const FLOWCHART_SCHEMA_VERSION = 1;

// 일반적인 플로우차트 도형 모음
export type FlowchartNodeShape =
  | "rectangle" // 처리(process)
  | "roundRectangle" // 둥근 사각형
  | "terminator" // 시작/종료(터미널, 스타디움)
  | "ellipse" // 원형
  | "diamond" // 판단(decision)
  | "parallelogram" // 입출력(data)
  | "hexagon" // 준비(preparation)
  | "cylinder" // 데이터베이스
  | "document"; // 문서

// 도형에 연결할 링크 — 외부 웹 URL 또는 내부 페이지 멘션
export type FlowchartNodeLink =
  | { type: "url"; url: string }
  | { type: "page"; pageId: string; label?: string };

export type FlowchartNodeData = {
  /** 노드 안에 표시할 텍스트 */
  label: string;
  /** 도형 종류 */
  shape: FlowchartNodeShape;
  /** 배경색(hex 또는 CSS 색). 미지정 시 기본 테마색 */
  color?: string;
  /** 연결된 링크(외부 URL / 내부 페이지) */
  link?: FlowchartNodeLink;
};

export type FlowchartNode = {
  id: string;
  /** React Flow custom node 타입. 현재는 단일 "shape" 노드만 사용 */
  type: "shape";
  position: { x: number; y: number };
  data: FlowchartNodeData;
  width?: number;
  height?: number;
};

export type FlowchartEdge = {
  id: string;
  source: string;
  target: string;
  /** 연결된 도형의 변(핸들) id. 없으면 React Flow 가 임의로 붙여 화살표가 꼬인다. */
  sourceHandle?: string;
  targetHandle?: string;
  /** 화살표 위 텍스트 (예: "성공", "실패") */
  label?: string;
  /** 선/화살표 색상 (hex). 미지정 시 기본색 */
  color?: string;
};

export type FlowchartViewport = { x: number; y: number; zoom: number };

export type FlowchartData = {
  version: number;
  nodes: FlowchartNode[];
  edges: FlowchartEdge[];
  viewport?: FlowchartViewport;
};

// 여러 페이지가 flowchartId 로 공유하는 서버 동기 레코드.
// 블록 attrs 에는 flowchartId 만 두고, 실제 데이터는 이 레코드(=flowchartStore/서버)에 둔다.
export type FlowchartRecord = {
  id: string;
  workspaceId: string | null;
  title: string;
  data: FlowchartData;
  /** LWW 충돌 해소용 epoch ms */
  updatedAt: number;
  deletedAt?: number | null;
};

const VALID_SHAPES: ReadonlySet<string> = new Set<FlowchartNodeShape>([
  "rectangle",
  "roundRectangle",
  "terminator",
  "ellipse",
  "diamond",
  "parallelogram",
  "hexagon",
  "cylinder",
  "document",
]);

export function emptyFlowchart(): FlowchartData {
  return {
    version: FLOWCHART_SCHEMA_VERSION,
    nodes: [],
    edges: [],
  };
}

/** attrs 에 저장할 JSON 문자열로 직렬화한다. (단일 인코딩) */
export function serializeFlowchart(data: FlowchartData): string {
  return JSON.stringify(data);
}

function coerceLink(raw: unknown): FlowchartNodeLink | null {
  if (!raw || typeof raw !== "object") return null;
  const l = raw as Record<string, unknown>;
  if (l.type === "url" && typeof l.url === "string" && l.url.trim() !== "") {
    return { type: "url", url: l.url };
  }
  if (l.type === "page" && typeof l.pageId === "string" && l.pageId !== "") {
    return {
      type: "page",
      pageId: l.pageId,
      ...(typeof l.label === "string" ? { label: l.label } : {}),
    };
  }
  return null;
}

function coerceNode(raw: unknown): FlowchartNode | null {
  if (!raw || typeof raw !== "object") return null;
  const n = raw as Record<string, unknown>;
  const id = typeof n.id === "string" ? n.id : null;
  if (!id) return null;
  const pos = n.position as Record<string, unknown> | undefined;
  const x = typeof pos?.x === "number" ? pos.x : 0;
  const y = typeof pos?.y === "number" ? pos.y : 0;
  const dataRaw = (n.data as Record<string, unknown> | undefined) ?? {};
  const shapeRaw = dataRaw.shape;
  const shape: FlowchartNodeShape = VALID_SHAPES.has(String(shapeRaw))
    ? (shapeRaw as FlowchartNodeShape)
    : "rectangle";
  const link = coerceLink(dataRaw.link);
  const node: FlowchartNode = {
    id,
    type: "shape",
    position: { x, y },
    data: {
      label: typeof dataRaw.label === "string" ? dataRaw.label : "",
      shape,
      ...(typeof dataRaw.color === "string" ? { color: dataRaw.color } : {}),
      ...(link ? { link } : {}),
    },
    ...(typeof n.width === "number" ? { width: n.width } : {}),
    ...(typeof n.height === "number" ? { height: n.height } : {}),
  };
  return node;
}

function coerceEdge(raw: unknown): FlowchartEdge | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const id = typeof e.id === "string" ? e.id : null;
  const source = typeof e.source === "string" ? e.source : null;
  const target = typeof e.target === "string" ? e.target : null;
  if (!id || !source || !target) return null;
  return {
    id,
    source,
    target,
    ...(typeof e.sourceHandle === "string"
      ? { sourceHandle: e.sourceHandle }
      : {}),
    ...(typeof e.targetHandle === "string"
      ? { targetHandle: e.targetHandle }
      : {}),
    ...(typeof e.label === "string" ? { label: e.label } : {}),
    ...(typeof e.color === "string" ? { color: e.color } : {}),
  };
}

/**
 * attrs 에서 읽은 값을 FlowchartData 로 안전하게 파싱한다.
 * - 문자열이면 JSON.parse. 이중 인코딩(문자열 안의 문자열)도 1회 더 풀어준다.
 * - 형식이 깨졌거나 비면 빈 플로우차트를 돌려준다. (절대 throw 하지 않음)
 */
export function parseFlowchart(raw: unknown): FlowchartData {
  let value: unknown = raw;
  // 최대 2회까지 문자열 디코딩 (이중 인코딩 방어)
  for (let i = 0; i < 2 && typeof value === "string"; i++) {
    if (value.trim() === "") return emptyFlowchart();
    try {
      value = JSON.parse(value);
    } catch {
      return emptyFlowchart();
    }
  }
  if (!value || typeof value !== "object") return emptyFlowchart();
  const obj = value as Record<string, unknown>;
  const nodes = Array.isArray(obj.nodes)
    ? obj.nodes.map(coerceNode).filter((n): n is FlowchartNode => n !== null)
    : [];
  const edges = Array.isArray(obj.edges)
    ? obj.edges.map(coerceEdge).filter((e): e is FlowchartEdge => e !== null)
    : [];
  // 끊긴 엣지(존재하지 않는 노드 참조) 제거
  const nodeIds = new Set(nodes.map((n) => n.id));
  const validEdges = edges.filter(
    (e) => nodeIds.has(e.source) && nodeIds.has(e.target),
  );
  const vp = obj.viewport as Record<string, unknown> | undefined;
  const viewport =
    vp &&
    typeof vp.x === "number" &&
    typeof vp.y === "number" &&
    typeof vp.zoom === "number"
      ? { x: vp.x, y: vp.y, zoom: vp.zoom }
      : undefined;
  return {
    version:
      typeof obj.version === "number" ? obj.version : FLOWCHART_SCHEMA_VERSION,
    nodes,
    edges: validEdges,
    ...(viewport ? { viewport } : {}),
  };
}

// 실측 크기가 없는 노드의 추정 크기 (ShapeNode 의 min 크기 기준)
const DEFAULT_NODE_W = 120;
const DEFAULT_NODE_H = 60;
const DIAMOND_SIZE = 96;

function estimateNodeSize(n: FlowchartNode): { w: number; h: number } {
  const isDiamond = n.data.shape === "diamond";
  return {
    w: n.width ?? (isDiamond ? DIAMOND_SIZE : DEFAULT_NODE_W),
    h: n.height ?? (isDiamond ? DIAMOND_SIZE : DEFAULT_NODE_H),
  };
}

/**
 * 모든 노드를 감싸는 바운딩박스(원점·크기)를 구한다.
 * 미리보기 비율 계산 및 결정적 뷰포트(fitView 대체) 계산에 쓴다. 노드가 없으면 null.
 */
export function getFlowchartBounds(
  data: FlowchartData,
): { minX: number; minY: number; width: number; height: number } | null {
  if (data.nodes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of data.nodes) {
    const { w, h } = estimateNodeSize(n);
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + w);
    maxY = Math.max(maxY, n.position.y + h);
  }
  return {
    minX,
    minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

/** 새 노드/엣지용 고유 id 생성 */
export function createFlowchartId(prefix: "n" | "e"): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Math.random().toString(36).slice(2)}${Math.random()
          .toString(36)
          .slice(2)}`;
  return `${prefix}_${rand}`;
}
