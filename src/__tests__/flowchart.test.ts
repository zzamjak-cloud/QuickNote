import { describe, it, expect } from "vitest";
import {
  emptyFlowchart,
  serializeFlowchart,
  parseFlowchart,
  getFlowchartBounds,
  createFlowchartId,
  FLOWCHART_SCHEMA_VERSION,
  type FlowchartData,
} from "../types/flowchart";

const sample: FlowchartData = {
  version: FLOWCHART_SCHEMA_VERSION,
  nodes: [
    {
      id: "n1",
      type: "shape",
      position: { x: 10, y: 20 },
      data: { label: "시작", shape: "ellipse", color: "#fde68a" },
    },
    {
      id: "n2",
      type: "shape",
      position: { x: 100, y: 200 },
      data: {
        label: "처리",
        shape: "rectangle",
        link: { type: "page", pageId: "p1", label: "대상 페이지" },
      },
    },
  ],
  edges: [
    {
      id: "e1",
      source: "n1",
      target: "n2",
      sourceHandle: "bottom",
      targetHandle: "top",
      label: "다음",
    },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
};

describe("emptyFlowchart", () => {
  it("빈 노드·엣지와 현재 스키마 버전을 가진다", () => {
    const empty = emptyFlowchart();
    expect(empty.nodes).toEqual([]);
    expect(empty.edges).toEqual([]);
    expect(empty.version).toBe(FLOWCHART_SCHEMA_VERSION);
  });
});

describe("serialize/parse 라운드트립", () => {
  it("직렬화 후 파싱하면 동일 데이터를 복원한다", () => {
    const restored = parseFlowchart(serializeFlowchart(sample));
    expect(restored).toEqual(sample);
  });

  it("객체를 직접 넘겨도 파싱한다", () => {
    expect(parseFlowchart(sample)).toEqual(sample);
  });
});

describe("이중 인코딩 방어", () => {
  it("문자열 안의 문자열(이중 인코딩)도 복원한다", () => {
    const double = JSON.stringify(serializeFlowchart(sample));
    expect(parseFlowchart(double)).toEqual(sample);
  });
});

describe("malformed 입력 가드", () => {
  it("깨진 JSON 은 빈 플로우차트를 돌려준다", () => {
    expect(parseFlowchart("{not json")).toEqual(emptyFlowchart());
  });
  it("null/undefined/숫자는 빈 플로우차트를 돌려준다", () => {
    expect(parseFlowchart(null)).toEqual(emptyFlowchart());
    expect(parseFlowchart(undefined)).toEqual(emptyFlowchart());
    expect(parseFlowchart(42)).toEqual(emptyFlowchart());
  });
  it("빈 문자열은 빈 플로우차트를 돌려준다", () => {
    expect(parseFlowchart("")).toEqual(emptyFlowchart());
  });
});

describe("도형 링크", () => {
  it("페이지 링크를 라운드트립한다", () => {
    const restored = parseFlowchart(serializeFlowchart(sample));
    expect(restored.nodes[1].data.link).toEqual({
      type: "page",
      pageId: "p1",
      label: "대상 페이지",
    });
  });
  it("URL 링크를 라운드트립한다", () => {
    const out = parseFlowchart({
      nodes: [
        {
          id: "a",
          position: { x: 0, y: 0 },
          data: { shape: "rectangle", link: { type: "url", url: "https://x.io" } },
        },
      ],
      edges: [],
    });
    expect(out.nodes[0].data.link).toEqual({ type: "url", url: "https://x.io" });
  });
  it("형식이 깨진 링크는 버린다", () => {
    const out = parseFlowchart({
      nodes: [
        {
          id: "a",
          position: { x: 0, y: 0 },
          data: { shape: "rectangle", link: { type: "url", url: "" } },
        },
        {
          id: "b",
          position: { x: 0, y: 0 },
          data: { shape: "rectangle", link: { type: "page" } },
        },
      ],
      edges: [],
    });
    expect(out.nodes[0].data.link).toBeUndefined();
    expect(out.nodes[1].data.link).toBeUndefined();
  });
});

describe("형식 정규화", () => {
  it("알 수 없는 shape 는 rectangle 로 보정한다", () => {
    const out = parseFlowchart({
      nodes: [{ id: "x", position: { x: 0, y: 0 }, data: { shape: "star" } }],
      edges: [],
    });
    expect(out.nodes[0].data.shape).toBe("rectangle");
  });
  it("id 없는 노드는 버린다", () => {
    const out = parseFlowchart({
      nodes: [{ position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    });
    expect(out.nodes).toHaveLength(0);
  });
  it("엣지의 sourceHandle/targetHandle 을 보존한다 (화살표 위치 유지)", () => {
    const restored = parseFlowchart(serializeFlowchart(sample));
    expect(restored.edges[0].sourceHandle).toBe("bottom");
    expect(restored.edges[0].targetHandle).toBe("top");
  });
  it("존재하지 않는 노드를 가리키는 끊긴 엣지는 제거한다", () => {
    const out = parseFlowchart({
      nodes: [{ id: "n1", position: { x: 0, y: 0 }, data: {} }],
      edges: [
        { id: "e1", source: "n1", target: "ghost" },
        { id: "e2", source: "n1", target: "n1" },
      ],
    });
    expect(out.edges.map((e) => e.id)).toEqual(["e2"]);
  });
});

describe("getFlowchartBounds", () => {
  it("노드가 없으면 null", () => {
    expect(getFlowchartBounds(emptyFlowchart())).toBeNull();
  });
  it("실측 크기를 가진 노드들의 바운딩박스를 계산한다", () => {
    const data = parseFlowchart({
      nodes: [
        {
          id: "a",
          position: { x: 0, y: 0 },
          data: { shape: "rectangle" },
          width: 100,
          height: 50,
        },
        {
          id: "b",
          position: { x: 200, y: 100 },
          data: { shape: "rectangle" },
          width: 100,
          height: 50,
        },
      ],
      edges: [],
    });
    expect(getFlowchartBounds(data)).toEqual({ width: 300, height: 150 });
  });
  it("실측 크기가 없으면 기본 크기로 추정한다", () => {
    const data = parseFlowchart({
      nodes: [{ id: "a", position: { x: 0, y: 0 }, data: { shape: "rectangle" } }],
      edges: [],
    });
    const b = getFlowchartBounds(data);
    expect(b).not.toBeNull();
    expect(b?.width ?? 0).toBeGreaterThan(0);
    expect(b?.height ?? 0).toBeGreaterThan(0);
  });
});

describe("createFlowchartId", () => {
  it("접두사를 붙인 고유 id 를 만든다", () => {
    const a = createFlowchartId("n");
    const b = createFlowchartId("n");
    expect(a.startsWith("n_")).toBe(true);
    expect(a).not.toBe(b);
  });
});
