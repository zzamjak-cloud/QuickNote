// get_users — 멤버 목록(멘션·person 셀 해석용).
// - workspaceId 지정: 그 워크스페이스 접근 가능 멤버만.
// - 미지정 + 범위 토큰(workspaceIds 有): 범위 내 접근 가능한 워크스페이스 멤버의 합집합.
// - 미지정 + 무범위 토큰: 활성 멤버 전체(멘션 검색과 같은 공개 범위).
// 테이블 Scan 은 요청당 1회만 수행하고, 반환 필드는 id·name·email 로 최소화한다.
import { QueryCommand, ScanCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { computeEffectiveLevel, LC_SCHEDULER_WORKSPACE_ID } from "../../v5-resolvers/handlers/_auth";
import { canAccessWorkspace, requireWorkspace } from "../access";
import type { McpContext } from "../context";
import { getItem } from "../ddb";

export const getUsersInputShape = {
  workspaceId: z.string().min(1).max(128).optional().describe("Only members who can access this workspace"),
};
const getUsersInput = z.object(getUsersInputShape);
export type GetUsersInput = z.input<typeof getUsersInput>;

type Item = Record<string, unknown>;
type MemberLite = { memberId: string; name: string; email: string; workspaceRole: string };
const IMPLICIT_ACCESS_ROLES = new Set(["developer", "owner", "leader"]);

async function scanAll(
  doc: DynamoDBDocumentClient,
  tableName: string,
  projection: { expr: string; names?: Record<string, string> },
): Promise<Item[]> {
  const items: Item[] = [];
  let lastKey: Item | undefined;
  do {
    const r = await doc.send(
      new ScanCommand({
        TableName: tableName,
        ProjectionExpression: projection.expr,
        ...(projection.names ? { ExpressionAttributeNames: projection.names } : {}),
        ExclusiveStartKey: lastKey,
      }),
    );
    items.push(...((r.Items ?? []) as Item[]));
    lastKey = r.LastEvaluatedKey as Item | undefined;
  } while (lastKey);
  return items;
}

async function loadActiveMembers(ctx: McpContext): Promise<MemberLite[]> {
  const items = await scanAll(ctx.doc, ctx.tables.Members, {
    expr: "memberId, #n, email, #s, workspaceRole",
    names: { "#n": "name", "#s": "status" },
  });
  return items
    .filter((m) => m.status === "active")
    .map((m) => ({
      memberId: String(m.memberId),
      name: String(m.name ?? ""),
      email: String(m.email ?? ""),
      workspaceRole: String(m.workspaceRole ?? "member"),
    }));
}

/** MemberTeams 전체 Scan 을 요청당 한 번으로 묶는 지연 로더. */
function teamIndexLoader(ctx: McpContext): () => Promise<Map<string, string[]>> {
  let cached: Promise<Map<string, string[]>> | null = null;
  return () => {
    cached ??= scanAll(ctx.doc, ctx.tables.MemberTeams, { expr: "memberId, teamId" }).then((rows) => {
      const index = new Map<string, string[]>();
      for (const row of rows) {
        const id = String(row.memberId);
        index.set(id, [...(index.get(id) ?? []), String(row.teamId)]);
      }
      return index;
    });
    return cached;
  };
}

async function workspaceMemberFilter(
  ctx: McpContext,
  workspaceId: string,
  loadTeams: () => Promise<Map<string, string[]>>,
): Promise<(m: MemberLite) => boolean> {
  if (workspaceId === LC_SCHEDULER_WORKSPACE_ID) return () => true;
  const row = await getItem(ctx.doc, ctx.tables.Workspaces, { workspaceId });
  // 개인 워크스페이스는 소유자만 실사용 멤버로 본다.
  if (row?.type === "personal") return (m) => m.memberId === row.ownerMemberId;
  const access = await ctx.doc.send(
    new QueryCommand({
      TableName: ctx.tables.WorkspaceAccess,
      KeyConditionExpression: "workspaceId = :w",
      ExpressionAttributeValues: { ":w": workspaceId },
    }),
  );
  const entries = (access.Items ?? []).map((i) => ({
    subjectType: i.subjectType as "member" | "team" | "everyone",
    subjectId: (i.subjectId as string | undefined) ?? null,
    level: i.level as "edit" | "view",
  }));
  const teams = await loadTeams();
  return (m) =>
    IMPLICIT_ACCESS_ROLES.has(m.workspaceRole) ||
    computeEffectiveLevel(entries, m.memberId, teams.get(m.memberId) ?? []) !== null;
}

/** 대상 워크스페이스 목록. null = 제한 없음(무범위 토큰의 전체 조회). */
async function targetWorkspaceIds(ctx: McpContext, workspaceId?: string): Promise<string[] | null> {
  if (workspaceId) {
    await requireWorkspace(ctx, workspaceId);
    return [workspaceId];
  }
  const scoped = ctx.token.workspaceIds ?? [];
  if (scoped.length === 0) return null;
  const allowed: string[] = [];
  for (const id of scoped) if (await canAccessWorkspace(ctx, id)) allowed.push(id);
  return allowed;
}

export async function getUsersTool(ctx: McpContext, raw: GetUsersInput) {
  const input = getUsersInput.parse(raw);
  const targets = await targetWorkspaceIds(ctx, input.workspaceId);
  if (targets !== null && targets.length === 0) return { users: [] };
  const members = await loadActiveMembers(ctx);
  let visible = members;
  if (targets !== null) {
    const loadTeams = teamIndexLoader(ctx);
    const filters = await Promise.all(targets.map((id) => workspaceMemberFilter(ctx, id, loadTeams)));
    visible = members.filter((m) => filters.some((f) => f(m)));
  }
  return {
    users: visible
      .map((m) => ({ id: m.memberId, name: m.name, email: m.email }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
