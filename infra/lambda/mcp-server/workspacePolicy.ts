// 워크스페이스 레코드(유형·소유자·MCP 정책) 조회 — 같은 요청 안에서는 한 번만 읽고(요청 캐시),
// 요청 사이에는 컨테이너 캐시를 15초만 쓴다(정책 변경이 늦어도 30초 안에 반영돼야 한다).
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { normalizeMcpPolicy, type McpPolicy } from "../_shared/mcpPolicy";
import type { McpContext } from "./context";
import { getItem } from "./ddb";

export const WORKSPACE_POLICY_CACHE_TTL_MS = 15_000;

export type WorkspaceInfo = { exists: boolean; type: string | null; mcpPolicy: McpPolicy };

const containerCache = new WeakMap<DynamoDBDocumentClient, Map<string, { at: number; info: WorkspaceInfo }>>();
const requestCache = new WeakMap<McpContext, Map<string, Promise<WorkspaceInfo>>>();

function containerMap(doc: DynamoDBDocumentClient) {
  let m = containerCache.get(doc);
  if (!m) {
    m = new Map();
    containerCache.set(doc, m);
  }
  return m;
}

async function readInfo(ctx: McpContext, workspaceId: string, nowMs: number): Promise<WorkspaceInfo> {
  const key = `${ctx.tables.Workspaces}|${workspaceId}`;
  const hit = containerMap(ctx.doc).get(key);
  if (hit && nowMs - hit.at < WORKSPACE_POLICY_CACHE_TTL_MS) return hit.info;
  const row = await getItem(ctx.doc, ctx.tables.Workspaces, { workspaceId });
  const info: WorkspaceInfo = {
    exists: Boolean(row),
    type: typeof row?.type === "string" ? row.type : null,
    mcpPolicy: normalizeMcpPolicy(row?.mcpPolicy),
  };
  containerMap(ctx.doc).set(key, { at: nowMs, info });
  return info;
}

export function workspaceInfo(ctx: McpContext, workspaceId: string, nowMs = Date.now()): Promise<WorkspaceInfo> {
  let perRequest = requestCache.get(ctx);
  if (!perRequest) {
    perRequest = new Map();
    requestCache.set(ctx, perRequest);
  }
  let pending = perRequest.get(workspaceId);
  if (!pending) {
    pending = readInfo(ctx, workspaceId, nowMs);
    perRequest.set(workspaceId, pending);
  }
  return pending;
}

/** 테스트 전용: 컨테이너 캐시 비우기(같은 클라이언트로 정책을 바꿔 가며 검사할 때). */
export function resetWorkspacePolicyCache(doc: DynamoDBDocumentClient): void {
  containerCache.delete(doc);
}
