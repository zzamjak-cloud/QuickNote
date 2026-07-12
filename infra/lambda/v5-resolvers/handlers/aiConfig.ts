// 워크스페이스 AI 설정 리졸버 — API 키는 KMS 로 암호화해 저장하고,
// 조회는 어떤 경로로도 원문을 반환하지 않는다(마스킹·hasKey 만).
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { KMSClient, EncryptCommand } from "@aws-sdk/client-kms";
import {
  badRequest,
  forbidden,
  requireWorkspaceAccess,
  type Member,
} from "./_auth";
import type { Tables } from "./member";

const kms = new KMSClient({});

/** 서버가 허용하는 AI 제공사·모델 화이트리스트. 클라이언트 임의 값을 받지 않는다. */
export const AI_PROVIDERS = ["gemini"] as const;
export const AI_DEFAULT_MODEL = "gemini-2.5-flash";
export const AI_ALLOWED_MODELS = ["gemini-2.5-flash", "gemini-2.5-pro"] as const;

type AiConfigItem = {
  workspaceId: string;
  enabled?: boolean;
  provider?: string;
  /** KMS 암호문(base64). 클라이언트 응답에 절대 포함 금지. */
  apiKeyEnc?: string;
  apiKeyLast4?: string;
  defaultModel?: string;
  updatedAt?: string;
};

export type WorkspaceAiConfigGql = {
  workspaceId: string;
  enabled: boolean;
  provider: string;
  hasKey: boolean;
  apiKeyMasked: string | null;
  defaultModel: string;
  updatedAt: string | null;
};

/** DDB 아이템 → GraphQL 응답. 키 원문/암호문은 여기서 걸러진다. */
export function aiConfigToGql(
  workspaceId: string,
  item: AiConfigItem | undefined,
): WorkspaceAiConfigGql {
  return {
    workspaceId,
    enabled: item?.enabled === true,
    provider: item?.provider ?? AI_PROVIDERS[0],
    hasKey: Boolean(item?.apiKeyEnc),
    apiKeyMasked: item?.apiKeyEnc ? `****${item.apiKeyLast4 ?? ""}` : null,
    defaultModel: item?.defaultModel ?? AI_DEFAULT_MODEL,
    updatedAt: item?.updatedAt ?? null,
  };
}

function requireAiConfigTable(tables: Tables): string {
  const t = tables.WorkspaceAiConfig;
  if (!t) throw new Error("WORKSPACE_AI_CONFIG_TABLE_NAME 미설정");
  return t;
}

/** 설정 mutation 은 developer 전용 — 설정 탭 노출 정책과 동일 기준. */
function requireDeveloper(caller: Member): void {
  if (caller.workspaceRole !== "developer") forbidden("developer 만 가능");
}

async function getAiConfigItem(
  doc: DynamoDBDocumentClient,
  table: string,
  workspaceId: string,
): Promise<AiConfigItem | undefined> {
  const r = await doc.send(new GetCommand({ TableName: table, Key: { workspaceId } }));
  return r.Item as AiConfigItem | undefined;
}

type BaseArgs = { doc: DynamoDBDocumentClient; tables: Tables; caller: Member };

export async function getWorkspaceAiConfig(
  args: BaseArgs & { workspaceId: string },
): Promise<WorkspaceAiConfigGql> {
  if (!args.workspaceId) badRequest("workspaceId 필요");
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "view",
  });
  const item = await getAiConfigItem(args.doc, requireAiConfigTable(args.tables), args.workspaceId);
  return aiConfigToGql(args.workspaceId, item);
}

export async function setWorkspaceAiKey(
  args: BaseArgs & { workspaceId: string; provider: string; apiKey: string },
): Promise<WorkspaceAiConfigGql> {
  requireDeveloper(args.caller);
  if (!args.workspaceId) badRequest("workspaceId 필요");
  if (!(AI_PROVIDERS as readonly string[]).includes(args.provider)) {
    badRequest(`지원하지 않는 provider: ${args.provider}`);
  }
  const apiKey = args.apiKey.trim();
  if (apiKey.length < 10 || apiKey.length > 300) badRequest("API 키 형식이 올바르지 않습니다");

  const keyArn = process.env.AI_KMS_KEY_ARN;
  if (!keyArn) throw new Error("AI_KMS_KEY_ARN 미설정");
  const enc = await kms.send(
    new EncryptCommand({ KeyId: keyArn, Plaintext: Buffer.from(apiKey, "utf-8") }),
  );
  if (!enc.CiphertextBlob) throw new Error("KMS 암호화 실패");

  const r = await args.doc.send(
    new UpdateCommand({
      TableName: requireAiConfigTable(args.tables),
      Key: { workspaceId: args.workspaceId },
      UpdateExpression:
        "SET provider = :p, apiKeyEnc = :e, apiKeyLast4 = :l, updatedAt = :t",
      ExpressionAttributeValues: {
        ":p": args.provider,
        ":e": Buffer.from(enc.CiphertextBlob).toString("base64"),
        ":l": apiKey.slice(-4),
        ":t": new Date().toISOString(),
      },
      ReturnValues: "ALL_NEW",
    }),
  );
  return aiConfigToGql(args.workspaceId, r.Attributes as AiConfigItem);
}

export async function clearWorkspaceAiKey(
  args: BaseArgs & { workspaceId: string },
): Promise<WorkspaceAiConfigGql> {
  requireDeveloper(args.caller);
  if (!args.workspaceId) badRequest("workspaceId 필요");
  const r = await args.doc.send(
    new UpdateCommand({
      TableName: requireAiConfigTable(args.tables),
      Key: { workspaceId: args.workspaceId },
      // 키 제거 시 AI 도 함께 비활성화 — 키 없는 enabled 상태를 남기지 않는다.
      UpdateExpression: "REMOVE apiKeyEnc, apiKeyLast4 SET enabled = :f, updatedAt = :t",
      ExpressionAttributeValues: { ":f": false, ":t": new Date().toISOString() },
      ReturnValues: "ALL_NEW",
    }),
  );
  return aiConfigToGql(args.workspaceId, r.Attributes as AiConfigItem);
}

export async function updateWorkspaceAiSettings(
  args: BaseArgs & { workspaceId: string; enabled?: boolean | null; defaultModel?: string | null },
): Promise<WorkspaceAiConfigGql> {
  requireDeveloper(args.caller);
  if (!args.workspaceId) badRequest("workspaceId 필요");

  const sets: string[] = ["updatedAt = :t"];
  const values: Record<string, unknown> = { ":t": new Date().toISOString() };
  if (typeof args.enabled === "boolean") {
    if (args.enabled) {
      // 키가 없는데 enabled 로 켜는 것을 거부 — UI 게이팅과 서버 상태 일치 보장.
      const item = await getAiConfigItem(
        args.doc,
        requireAiConfigTable(args.tables),
        args.workspaceId,
      );
      if (!item?.apiKeyEnc) badRequest("API 키를 먼저 등록해야 합니다");
    }
    sets.push("enabled = :e");
    values[":e"] = args.enabled;
  }
  if (typeof args.defaultModel === "string") {
    if (!(AI_ALLOWED_MODELS as readonly string[]).includes(args.defaultModel)) {
      badRequest(`지원하지 않는 모델: ${args.defaultModel}`);
    }
    sets.push("defaultModel = :m");
    values[":m"] = args.defaultModel;
  }

  const r = await args.doc.send(
    new UpdateCommand({
      TableName: requireAiConfigTable(args.tables),
      Key: { workspaceId: args.workspaceId },
      UpdateExpression: `SET ${sets.join(", ")}`,
      ExpressionAttributeValues: values,
      ReturnValues: "ALL_NEW",
    }),
  );
  return aiConfigToGql(args.workspaceId, r.Attributes as AiConfigItem);
}
