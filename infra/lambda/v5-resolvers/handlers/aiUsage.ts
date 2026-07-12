// 워크스페이스 AI 사용량 조회 — ai-proxy 가 기록한 월별·사용자별 토큰 집계를 반환.
// 개인별 사용 내역이 포함되므로 developer 전용(설정 AI 탭과 동일 기준).
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { badRequest, type Member } from "./_auth";
import { requireDeveloper } from "./aiConfig";
import type { Tables } from "./member";

export type AiUsageMemberEntryGql = {
  memberId: string;
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
};

export type WorkspaceAiUsageGql = {
  workspaceId: string;
  month: string;
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
  members: AiUsageMemberEntryGql[];
};

function requireAiUsageTable(tables: Tables): string {
  const t = tables.AiUsage;
  if (!t) throw new Error("AI_USAGE_TABLE_NAME 미설정");
  return t;
}

export async function getWorkspaceAiUsage(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  workspaceId: string;
  month?: string | null;
}): Promise<WorkspaceAiUsageGql> {
  requireDeveloper(args.caller);
  if (!args.workspaceId) badRequest("workspaceId 필요");
  const month = (args.month ?? "").trim() || new Date().toISOString().slice(0, 7).replace("-", "");
  if (!/^\d{6}$/.test(month)) badRequest("month 는 YYYYMM 형식");

  const r = await args.doc.send(
    new QueryCommand({
      TableName: requireAiUsageTable(args.tables),
      KeyConditionExpression: "pk = :p AND begins_with(sk, :m)",
      ExpressionAttributeValues: {
        ":p": `usage#${args.workspaceId}`,
        ":m": `${month}#`,
      },
    }),
  );

  const result: WorkspaceAiUsageGql = {
    workspaceId: args.workspaceId,
    month,
    inputTokens: 0,
    outputTokens: 0,
    requestCount: 0,
    members: [],
  };
  for (const item of r.Items ?? []) {
    const sk = item["sk"] as string;
    const memberId = sk.slice(month.length + 1);
    const entry = {
      inputTokens: Number(item["inputTokens"] ?? 0),
      outputTokens: Number(item["outputTokens"] ?? 0),
      requestCount: Number(item["requestCount"] ?? 0),
    };
    if (memberId === "__total") {
      result.inputTokens = entry.inputTokens;
      result.outputTokens = entry.outputTokens;
      result.requestCount = entry.requestCount;
    } else {
      result.members.push({ memberId, ...entry });
    }
  }
  result.members.sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens));
  return result;
}
