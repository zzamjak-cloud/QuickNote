// 플로우차트 — 공유 자원(Flowcharts, flowchartId 로 여러 블록이 공유)을 v5 flowchart 핸들러로 읽고 쓴다.
// 데이터 권위는 서버 레코드(LWW updatedAt). 클라 블록은 마운트 시 서버 최신본을 받아(applyRemote) 반영한다 —
// 플로우차트 실시간 구독은 없어서 이미 열린 블록은 다시 열어야 바뀐 차트가 보인다.
// 저장 때마다 앱처럼 버전 스냅샷을 쌓는다(직전 버전과 같으면 생략).
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  FLOWCHART_SCHEMA_VERSION,
  parseFlowchart,
  serializeFlowchart,
  type FlowchartData,
  type FlowchartEdge,
  type FlowchartNode,
} from "../../../../../src/types/flowchart";
import {
  getFlowchart,
  listFlowchartHistory,
  listFlowcharts,
  saveFlowchartVersion,
  upsertFlowchart,
} from "../../../v5-resolvers/handlers/flowchart";
import { NOT_ACCESSIBLE, requireWorkspace } from "../../access";
import { loadBodyBase, writePageBody } from "../../collabWriter";
import { ToolError, type McpContext } from "../../context";
import { getItem } from "../../ddb";
import { nextUpdatedAt } from "../../dbStructureWriter";
import { requireCollabEpoch } from "../../epochGuard";
import { loadWritablePage, requireWritableWorkspace, requireWriteScope } from "../../writeAccess";
import { contentTables, idInput, requireConfigured } from "./shared";

type Item = Record<string, unknown>;
type Side = "top" | "right" | "bottom" | "left";

const SHAPES = ["rectangle", "roundRectangle", "terminator", "ellipse", "diamond", "parallelogram", "hexagon", "cylinder", "document", "text"] as const;
const SIDES = ["top", "right", "bottom", "left"] as const;
const color = z.string().trim().max(40).regex(/^#[0-9a-fA-F]{3,8}$/, "color must be hex");

const nodeInput = z.object({
  id: z.string().trim().min(1).max(100),
  label: z.string().max(2000).default(""),
  shape: z.enum(SHAPES).default("rectangle"),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive().max(5000).optional(),
  height: z.number().positive().max(5000).optional(),
  color: color.optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  link: z.union([
    z.object({ type: z.literal("url"), url: z.string().trim().url().max(2048) }).strict(),
    z.object({ type: z.literal("page"), pageId: idInput, label: z.string().max(200).optional() }).strict(),
  ]).optional(),
}).strict();

const edgeInput = z.object({
  id: z.string().trim().min(1).max(100).optional(),
  from: z.string().trim().min(1).max(100).describe("Source node id"),
  to: z.string().trim().min(1).max(100).describe("Target node id"),
  fromSide: z.enum(SIDES).optional().describe("Side of the source shape; inferred from positions when omitted"),
  toSide: z.enum(SIDES).optional(),
  label: z.string().max(200).optional(),
  color: color.optional(),
}).strict();

const FLOWCHART_NOT_FOUND = "Flowchart not found or not accessible with this token";

function flowchartTables(ctx: McpContext) {
  const tables = contentTables(ctx);
  requireConfigured(tables.Flowcharts, "Flowcharts");
  return tables;
}

async function loadFlowchartRecord(ctx: McpContext, flowchartId: string): Promise<Item> {
  const tables = flowchartTables(ctx);
  const item = await getItem(ctx.doc, tables.Flowcharts as string, { id: flowchartId });
  if (!item || item.deletedAt) throw new ToolError(FLOWCHART_NOT_FOUND);
  return item;
}

function counts(data: FlowchartData) {
  return { nodes: data.nodes.length, edges: data.edges.length };
}

export const listFlowchartsInputShape = {
  workspaceId: idInput,
  limit: z.number().int().min(1).max(200).optional().describe("Default 100"),
};
const listFlowchartsInput = z.object(listFlowchartsInputShape);

export async function listFlowchartsTool(ctx: McpContext, raw: z.input<typeof listFlowchartsInput>) {
  const input = listFlowchartsInput.parse(raw);
  await requireWorkspace(ctx, input.workspaceId);
  const r = await listFlowcharts({ doc: ctx.doc, tables: flowchartTables(ctx), caller: ctx.caller, workspaceId: input.workspaceId, limit: input.limit ?? 100 });
  return {
    flowcharts: r.items.filter((f) => !f.deletedAt).map((f) => ({
      id: f.id, title: f.title ?? "", updatedAt: f.updatedAt ?? null, ...counts(parseFlowchart(f.data)),
    })),
    note: "In page bodies a flowchart appears as <qn-block id=\"<flowchartId>\" type=\"flowchartBlock\"/>.",
  };
}

export const getFlowchartInputShape = { flowchartId: idInput.describe("Flowchart id (the qn-block id of a flowchartBlock)") };
const getFlowchartInput = z.object(getFlowchartInputShape);

export async function getFlowchartTool(ctx: McpContext, raw: z.input<typeof getFlowchartInput>) {
  const input = getFlowchartInput.parse(raw);
  const record = await loadFlowchartRecord(ctx, input.flowchartId);
  const workspaceId = String(record.workspaceId ?? "");
  await requireWorkspace(ctx, workspaceId);
  const item = await getFlowchart({ doc: ctx.doc, tables: flowchartTables(ctx), caller: ctx.caller, id: input.flowchartId, workspaceId });
  if (!item) throw new ToolError(NOT_ACCESSIBLE);
  const data = parseFlowchart(item.data);
  return {
    id: input.flowchartId,
    workspaceId,
    title: item.title ?? "",
    updatedAt: item.updatedAt ?? null,
    nodes: data.nodes.map((n) => ({ id: n.id, label: n.data.label, shape: n.data.shape, x: n.position.x, y: n.position.y,
      ...(n.width ? { width: n.width } : {}), ...(n.height ? { height: n.height } : {}),
      ...(n.data.color ? { color: n.data.color } : {}), ...(n.data.align ? { align: n.data.align } : {}), ...(n.data.link ? { link: n.data.link } : {}) })),
    edges: data.edges.map((e) => ({ id: e.id, from: e.source, to: e.target, fromSide: e.sourceHandle ?? null, toSide: e.targetHandle ?? null,
      ...(e.label ? { label: e.label } : {}), ...(e.color ? { color: e.color } : {}) })),
  };
}

/** 핸들 미지정 시 두 도형의 상대 위치로 마주 보는 변을 고른다(없으면 클라가 임의 핸들로 붙여 화살표가 꼬인다). */
export function inferSides(from: FlowchartNode, to: FlowchartNode): [Side, Side] {
  const dx = to.position.x - from.position.x;
  const dy = to.position.y - from.position.y;
  if (Math.abs(dy) >= Math.abs(dx)) return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
  return dx >= 0 ? ["right", "left"] : ["left", "right"];
}

export function buildFlowchartData(nodes: z.infer<typeof nodeInput>[], edges: z.infer<typeof edgeInput>[]): FlowchartData {
  const ids = new Set<string>();
  const built: FlowchartNode[] = nodes.map((n) => {
    if (ids.has(n.id)) throw new ToolError(`Duplicate node id "${n.id}"`);
    ids.add(n.id);
    return {
      id: n.id, type: "shape", position: { x: n.x, y: n.y },
      data: { label: n.label, shape: n.shape, ...(n.color ? { color: n.color } : {}), ...(n.align ? { align: n.align } : {}), ...(n.link ? { link: n.link } : {}) },
      ...(n.width ? { width: n.width } : {}), ...(n.height ? { height: n.height } : {}),
    };
  });
  const byId = new Map(built.map((n) => [n.id, n]));
  const edgeIds = new Set(edges.map((e) => e.id).filter(Boolean));
  // id 생략 엣지는 결정적 id — 같은 차트를 다시 저장해도 데이터가 같아 버전이 중복 적립되지 않는다.
  const edgeId = (e: z.infer<typeof edgeInput>): string => {
    if (e.id) return e.id;
    let id = `e-${e.from}-${e.to}`;
    for (let n = 2; edgeIds.has(id); n += 1) id = `e-${e.from}-${e.to}-${n}`;
    edgeIds.add(id);
    return id;
  };
  const builtEdges: FlowchartEdge[] = edges.map((e, i) => {
    const source = byId.get(e.from);
    const target = byId.get(e.to);
    if (!source || !target) throw new ToolError(`Edge ${e.id ?? i + 1} references an unknown node (${source ? e.to : e.from})`);
    const [fromSide, toSide] = inferSides(source, target);
    return {
      id: edgeId(e), source: e.from, target: e.to,
      sourceHandle: e.fromSide ?? fromSide, targetHandle: e.toSide ?? toSide,
      ...(e.label ? { label: e.label } : {}), ...(e.color ? { color: e.color } : {}),
    };
  });
  return { version: FLOWCHART_SCHEMA_VERSION, nodes: built, edges: builtEdges };
}

export const saveFlowchartInputShape = {
  flowchartId: idInput.optional().describe("Existing flowchart to overwrite; omit to create a new one"),
  workspaceId: idInput.optional().describe("Required when creating"),
  title: z.string().trim().max(200).optional(),
  nodes: z.array(nodeInput).max(500).describe("Shapes; x/y are canvas coordinates (16px grid, ~160px apart reads well)"),
  edges: z.array(edgeInput).max(1000).default([]).describe("Arrows between node ids"),
  appendToPageId: idInput.optional().describe("Also insert a block showing this flowchart at the end of this page (same workspace)"),
};
const saveFlowchartInput = z.object(saveFlowchartInputShape);

async function saveVersionIfChanged(ctx: McpContext, flowchartId: string, workspaceId: string, title: string, dataJson: string): Promise<boolean> {
  const tables = contentTables(ctx);
  if (!tables.FlowchartHistory) return false;
  const [latest] = await listFlowchartHistory({ doc: ctx.doc, tables, caller: ctx.caller, flowchartId, workspaceId, limit: 1 });
  if (latest && latest.data === dataJson && (latest.title ?? "") === title) return false;
  await saveFlowchartVersion({ doc: ctx.doc, tables, caller: ctx.caller, flowchartId, workspaceId, title, data: dataJson });
  return true;
}

async function appendBlock(ctx: McpContext, pageId: string, workspaceId: string, block: Item): Promise<string> {
  const page = await loadWritablePage(ctx, pageId);
  if (page.workspaceId !== workspaceId) throw new ToolError("appendToPageId must be a page in the flowchart's workspace");
  await requireCollabEpoch(ctx);
  const base = await loadBodyBase(ctx, page);
  await writePageBody(ctx, page, base, { kind: "insert", blocks: [block as never], at: "end" });
  return String(page.id);
}

export async function saveFlowchartTool(ctx: McpContext, raw: z.input<typeof saveFlowchartInput>) {
  const input = saveFlowchartInput.parse(raw);
  requireWriteScope(ctx);
  const existing = input.flowchartId ? await loadFlowchartRecord(ctx, input.flowchartId) : null;
  const workspaceId = existing ? String(existing.workspaceId ?? "") : input.workspaceId;
  if (!workspaceId) throw new ToolError("workspaceId is required to create a flowchart");
  await requireWritableWorkspace(ctx, workspaceId);
  const data = buildFlowchartData(input.nodes, input.edges);
  const dataJson = serializeFlowchart(data);
  const id = existing ? String(existing.id) : randomUUID();
  const title = input.title ?? (existing ? String(existing.title ?? "") : "");
  const updatedAt = nextUpdatedAt(existing?.updatedAt);
  const saved = await upsertFlowchart({
    doc: ctx.doc, tables: flowchartTables(ctx), caller: ctx.caller,
    input: {
      id, workspaceId, title, data: dataJson, updatedAt,
      createdAt: existing?.createdAt ?? updatedAt,
      createdByMemberId: existing?.createdByMemberId ?? ctx.caller.memberId,
    },
  });
  if (saved.updatedAt !== updatedAt) throw new ToolError("The flowchart was changed concurrently; fetch it again and retry");
  const versionSaved = await saveVersionIfChanged(ctx, id, workspaceId, title, dataJson);
  const pageId = input.appendToPageId
    ? await appendBlock(ctx, input.appendToPageId, workspaceId, { type: "flowchartBlock", attrs: { flowchartId: id, data: dataJson, version: 1, title } })
    : null;
  return {
    flowchartId: id, workspaceId, title, created: !existing, updatedAt, versionSaved, ...counts(data),
    ...(pageId ? { insertedIntoPageId: pageId } : {}),
    note: "Open pages show the new chart after the flowchart block is reopened (no live push for flowcharts).",
  };
}

export const listFlowchartHistoryInputShape = {
  flowchartId: idInput,
  limit: z.number().int().min(1).max(100).optional().describe("Default 30, newest first"),
};
const listFlowchartHistoryInput = z.object(listFlowchartHistoryInputShape);

export async function listFlowchartHistoryTool(ctx: McpContext, raw: z.input<typeof listFlowchartHistoryInput>) {
  const input = listFlowchartHistoryInput.parse(raw);
  const record = await loadFlowchartRecord(ctx, input.flowchartId);
  const workspaceId = String(record.workspaceId ?? "");
  await requireWorkspace(ctx, workspaceId);
  const tables = contentTables(ctx);
  requireConfigured(tables.FlowchartHistory, "Flowchart history");
  const entries = await listFlowchartHistory({ doc: ctx.doc, tables, caller: ctx.caller, flowchartId: input.flowchartId, workspaceId, limit: input.limit ?? 30 });
  return {
    flowchartId: input.flowchartId,
    versions: entries.map((e) => ({
      historyId: e.historyId, createdAt: e.createdAt ?? null, editedBy: e.createdByName ?? e.createdByMemberId ?? null,
      title: e.title ?? "", ...counts(parseFlowchart(e.data)),
    })),
  };
}
