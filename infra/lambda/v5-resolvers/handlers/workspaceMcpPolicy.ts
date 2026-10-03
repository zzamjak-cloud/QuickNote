// 워크스페이스 MCP 허용 정책 설정 — 권한은 기존 워크스페이스 설정 규칙과 같다:
// 공유 워크스페이스는 manager 이상(updateWorkspace·setWorkspaceAccess 와 동일), 개인 워크스페이스는 소유자 본인만,
// LC 스케줄러 가상 워크스페이스는 변경 불가. MCP 서버는 30초 이하 캐시로 이 값을 시행한다(mcp-server/workspacePolicy.ts).
import { GetCommand, UpdateCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { MCP_POLICIES, type McpPolicy } from "../../_shared/mcpPolicy";
import { LC_SCHEDULER_WORKSPACE_ID, badRequest, forbidden, notFound, requireRoleAtLeast, type Member } from "./_auth";
import type { Tables } from "./member";
import { workspaceViewForAdmin, type Workspace } from "./workspace";

type Args = { doc: DynamoDBDocumentClient; tables: Tables; caller: Member; workspaceId: string; policy: string };

function parsePolicy(value: unknown): McpPolicy {
  if (!(MCP_POLICIES as readonly unknown[]).includes(value)) badRequest(`policy 는 ${MCP_POLICIES.join(" | ")} 중 하나`);
  return value as McpPolicy;
}

/** 정책 변경 권한 — 개인은 소유자 본인만(역할 무관), 공유는 manager 이상. */
export function requireMcpPolicyEditor(caller: Member, row: { workspaceId: string; type?: string; ownerMemberId?: string }): void {
  if (row.workspaceId === LC_SCHEDULER_WORKSPACE_ID) forbidden("LC스케줄러 워크스페이스 설정은 변경할 수 없습니다");
  if (row.type === "personal") {
    if (row.workspaceId !== caller.personalWorkspaceId && row.ownerMemberId !== caller.memberId) {
      forbidden("개인 워크스페이스 정책은 소유자만 변경할 수 있습니다");
    }
    return;
  }
  requireRoleAtLeast(caller, "manager");
}

export async function setWorkspaceMcpPolicy(args: Args): Promise<Workspace> {
  const workspaceId = typeof args.workspaceId === "string" ? args.workspaceId.trim() : "";
  if (!workspaceId) badRequest("workspaceId 필요");
  const policy = parsePolicy(args.policy);
  const r = await args.doc.send(new GetCommand({ TableName: args.tables.Workspaces, Key: { workspaceId } }));
  const row = r.Item as { workspaceId: string; type?: string; ownerMemberId?: string; removedAt?: string } | undefined;
  if (!row || row.removedAt) notFound("Workspace 없음");
  requireMcpPolicyEditor(args.caller, row);
  await args.doc.send(new UpdateCommand({
    TableName: args.tables.Workspaces,
    Key: { workspaceId },
    UpdateExpression: "SET mcpPolicy = :p",
    ConditionExpression: "attribute_exists(workspaceId)",
    ExpressionAttributeValues: { ":p": policy },
  }));
  console.info(JSON.stringify({ evt: "mcp.policy.set", memberId: args.caller.memberId, workspaceId, policy }));
  const updated = await workspaceViewForAdmin(args.doc, args.tables, workspaceId);
  if (!updated) notFound("Workspace 없음");
  return updated;
}
