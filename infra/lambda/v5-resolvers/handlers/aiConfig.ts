// 워크스페이스 AI 설정 리졸버 — 제공사별 API 키를 keys 맵에 KMS 암호화 저장.
// 조회는 원문을 반환하지 않는다(providers[].hasKey / apiKeyMasked 만).
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { KMSClient, EncryptCommand } from "@aws-sdk/client-kms";
import {
  badRequest,
  forbidden,
  requireWorkspaceAccess,
  type Member,
} from "./_auth";
import type { Tables } from "./member";

const kms = new KMSClient({});

/** 서버가 허용하는 AI 제공사·모델 화이트리스트. 클라이언트 src/lib/ai/models.ts 와 동기 유지. */
export const AI_PROVIDERS = ["gemini", "anthropic"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AI_MODELS_BY_PROVIDER: Record<AiProvider, readonly string[]> = {
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro"],
  anthropic: ["claude-haiku-4-5", "claude-sonnet-5"],
};

export const AI_DEFAULT_MODEL_BY_PROVIDER: Record<AiProvider, string> = {
  gemini: "gemini-2.5-flash",
  anthropic: "claude-haiku-4-5",
};

export function isAiProvider(v: string): v is AiProvider {
  return (AI_PROVIDERS as readonly string[]).includes(v);
}

/** 모델 ID → 제공사. 화이트리스트에 없으면 null. */
export function providerForModel(model: string): AiProvider | null {
  for (const p of AI_PROVIDERS) {
    if (AI_MODELS_BY_PROVIDER[p].includes(model)) return p;
  }
  return null;
}

/** 월 토큰 한도 상한(입력+출력 합산). 0 = 무제한. */
const MAX_MONTHLY_TOKEN_LIMIT = 2_000_000_000;

type StoredKey = { enc: string; last4: string };

type AiConfigItem = {
  workspaceId: string;
  enabled?: boolean;
  /** 레거시 단일 제공사 필드 — 읽기 시 keys 로 승격. */
  provider?: string;
  apiKeyEnc?: string;
  apiKeyLast4?: string;
  /** 제공사별 암호화 키. 클라이언트 응답에 절대 포함 금지. */
  keys?: Partial<Record<AiProvider, StoredKey>>;
  defaultModel?: string;
  monthlyTokenLimit?: number;
  updatedAt?: string;
};

export type WorkspaceAiProviderKeyGql = {
  provider: string;
  hasKey: boolean;
  apiKeyMasked: string | null;
};

export type WorkspaceAiConfigGql = {
  workspaceId: string;
  enabled: boolean;
  /** 하위호환 — defaultModel 제공사 또는 키가 있는 첫 제공사. */
  provider: string;
  hasKey: boolean;
  apiKeyMasked: string | null;
  providers: WorkspaceAiProviderKeyGql[];
  defaultModel: string;
  monthlyTokenLimit: number;
  updatedAt: string | null;
};

/** 레거시 apiKeyEnc 를 keys 맵에 병합(응답·검증용, DDB 쓰기는 별도). */
export function resolveKeysMap(
  item: Pick<AiConfigItem, "keys" | "apiKeyEnc" | "apiKeyLast4" | "provider"> | undefined,
): Partial<Record<AiProvider, StoredKey>> {
  const out: Partial<Record<AiProvider, StoredKey>> = { ...(item?.keys ?? {}) };
  if (item?.apiKeyEnc) {
    const p: AiProvider =
      item.provider && isAiProvider(item.provider) ? item.provider : "gemini";
    if (!out[p]?.enc) {
      out[p] = { enc: item.apiKeyEnc, last4: item.apiKeyLast4 ?? "" };
    }
  }
  return out;
}

export function providersWithKeys(
  keys: Partial<Record<AiProvider, StoredKey>>,
): AiProvider[] {
  return AI_PROVIDERS.filter((p) => Boolean(keys[p]?.enc));
}

function allowedModelsForKeys(keys: Partial<Record<AiProvider, StoredKey>>): string[] {
  return providersWithKeys(keys).flatMap((p) => [...AI_MODELS_BY_PROVIDER[p]]);
}

function pickDefaultModel(
  item: { defaultModel?: string } | undefined,
  keys: Partial<Record<AiProvider, StoredKey>>,
): string {
  const allowed = allowedModelsForKeys(keys);
  if (item?.defaultModel && allowed.includes(item.defaultModel)) return item.defaultModel;
  const first = providersWithKeys(keys)[0];
  return first ? AI_DEFAULT_MODEL_BY_PROVIDER[first] : AI_DEFAULT_MODEL_BY_PROVIDER.gemini;
}

/** DDB 아이템 → GraphQL 응답. 키 원문/암호문은 여기서 걸러진다. */
export function aiConfigToGql(
  workspaceId: string,
  item: AiConfigItem | undefined,
): WorkspaceAiConfigGql {
  const keys = resolveKeysMap(item);
  const providers: WorkspaceAiProviderKeyGql[] = AI_PROVIDERS.map((p) => {
    const slot = keys[p];
    return {
      provider: p,
      hasKey: Boolean(slot?.enc),
      apiKeyMasked: slot?.enc ? `****${slot.last4}` : null,
    };
  });
  const withKey = providersWithKeys(keys);
  const defaultModel = pickDefaultModel(item, keys);
  const compatProvider =
    providerForModel(defaultModel) ?? withKey[0] ?? ("gemini" as AiProvider);
  const compatMasked = providers.find((p) => p.provider === compatProvider)?.apiKeyMasked ?? null;

  return {
    workspaceId,
    enabled: item?.enabled === true,
    provider: compatProvider,
    hasKey: withKey.length > 0,
    apiKeyMasked: compatMasked,
    providers,
    defaultModel,
    monthlyTokenLimit: item?.monthlyTokenLimit ?? 0,
    updatedAt: item?.updatedAt ?? null,
  };
}

function requireAiConfigTable(tables: Tables): string {
  const t = tables.WorkspaceAiConfig;
  if (!t) throw new Error("WORKSPACE_AI_CONFIG_TABLE_NAME 미설정");
  return t;
}

/** 설정 mutation·사용량 조회는 developer 전용 — 설정 탭 노출 정책과 동일 기준. */
export function requireDeveloper(caller: Member): void {
  if (caller.workspaceRole !== "developer") forbidden("developer 만 가능");
}

/**
 * 전역 설정 아이템 PK — API 키·활성화·기본 모델은 QuickNote 전체 워크스페이스가 공유한다.
 * (스키마의 workspaceId 인자는 접근 검증용으로 유지 — 응답에는 호출한 workspaceId 를 에코)
 */
export const GLOBAL_AI_CONFIG_ID = "__global__";

async function getAiConfigItem(
  doc: DynamoDBDocumentClient,
  table: string,
  workspaceId: string,
): Promise<AiConfigItem | undefined> {
  const r = await doc.send(new GetCommand({ TableName: table, Key: { workspaceId } }));
  return r.Item as AiConfigItem | undefined;
}

/** 전역 아이템 우선, 없으면 레거시(워크스페이스별) 아이템 폴백 — 자연 마이그레이션 경로(읽기). */
async function getGlobalAiConfigItem(
  doc: DynamoDBDocumentClient,
  table: string,
  legacyWorkspaceId: string,
): Promise<AiConfigItem | undefined> {
  const global = await getAiConfigItem(doc, table, GLOBAL_AI_CONFIG_ID);
  if (global) return global;
  return getAiConfigItem(doc, table, legacyWorkspaceId);
}

/**
 * 뮤테이션 전 전역 아이템 확보 — 전역이 없고 레거시(호출 워크스페이스) 아이템이 있으면
 * enabled·키 등 전체를 전역으로 1회 복사한다(부분 필드만 전역에 쓰이면 레거시 폴백이
 * 끊겨 enabled/키가 초기화된 것처럼 보이는 문제 방지).
 */
async function ensureGlobalAiConfigItem(
  doc: DynamoDBDocumentClient,
  table: string,
  legacyWorkspaceId: string,
): Promise<AiConfigItem | undefined> {
  const global = await getAiConfigItem(doc, table, GLOBAL_AI_CONFIG_ID);
  if (global) return global;
  const legacy = await getAiConfigItem(doc, table, legacyWorkspaceId);
  if (!legacy) return undefined;
  try {
    await doc.send(
      new PutCommand({
        TableName: table,
        Item: { ...legacy, workspaceId: GLOBAL_AI_CONFIG_ID },
        ConditionExpression: "attribute_not_exists(workspaceId)",
      }),
    );
  } catch {
    // 동시 마이그레이션 경합 — 이미 전역 아이템이 생성됨
  }
  return getAiConfigItem(doc, table, GLOBAL_AI_CONFIG_ID);
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
  const item = await getGlobalAiConfigItem(
    args.doc,
    requireAiConfigTable(args.tables),
    args.workspaceId,
  );
  return aiConfigToGql(args.workspaceId, item);
}

export async function setWorkspaceAiKey(
  args: BaseArgs & { workspaceId: string; provider: string; apiKey: string },
): Promise<WorkspaceAiConfigGql> {
  requireDeveloper(args.caller);
  if (!args.workspaceId) badRequest("workspaceId 필요");
  if (!isAiProvider(args.provider)) {
    badRequest(`지원하지 않는 provider: ${args.provider}`);
  }
  const provider = args.provider as AiProvider;
  const apiKey = args.apiKey.trim();
  if (apiKey.length < 10 || apiKey.length > 300) badRequest("API 키 형식이 올바르지 않습니다");

  const keyArn = process.env.AI_KMS_KEY_ARN;
  if (!keyArn) throw new Error("AI_KMS_KEY_ARN 미설정");
  const enc = await kms.send(
    new EncryptCommand({ KeyId: keyArn, Plaintext: Buffer.from(apiKey, "utf-8") }),
  );
  if (!enc.CiphertextBlob) throw new Error("KMS 암호화 실패");

  const table = requireAiConfigTable(args.tables);
  const prev = await ensureGlobalAiConfigItem(args.doc, table, args.workspaceId);
  const prevKeys = resolveKeysMap(prev);
  const wasEmpty = providersWithKeys(prevKeys).length === 0;

  const slot: StoredKey = {
    enc: Buffer.from(enc.CiphertextBlob).toString("base64"),
    last4: apiKey.slice(-4),
  };

  // keys 맵 전체를 병합 후 통째로 SET — 중첩 경로 SET 은 부모 맵이 없으면(신규 아이템·
  // 레거시 아이템) ValidationException 이 나고, 레거시 apiKeyEnc 만 REMOVE 하면 타 제공사
  // 레거시 키가 마이그레이션 없이 유실되므로 resolveKeysMap 병합 결과를 그대로 쓴다.
  const nextKeys = { ...prevKeys, [provider]: slot };
  // 키가 처음 등록되면 defaultModel 을 그 제공사 기본값으로 맞춤(기존 기본이 없으면).
  const needDefault =
    wasEmpty ||
    !(prev?.defaultModel && allowedModelsForKeys(nextKeys).includes(prev.defaultModel));

  const r = await args.doc.send(
    new UpdateCommand({
      TableName: table,
      Key: { workspaceId: GLOBAL_AI_CONFIG_ID },
      UpdateExpression: needDefault
        ? "SET #keys = :keys, defaultModel = :m, updatedAt = :t REMOVE apiKeyEnc, apiKeyLast4, #legacyProvider"
        : "SET #keys = :keys, updatedAt = :t REMOVE apiKeyEnc, apiKeyLast4, #legacyProvider",
      ExpressionAttributeNames: {
        "#keys": "keys",
        "#legacyProvider": "provider",
      },
      ExpressionAttributeValues: {
        ":keys": nextKeys,
        ":t": new Date().toISOString(),
        ...(needDefault ? { ":m": AI_DEFAULT_MODEL_BY_PROVIDER[provider] } : {}),
      },
      ReturnValues: "ALL_NEW",
    }),
  );
  return aiConfigToGql(args.workspaceId, r.Attributes as AiConfigItem);
}

export async function clearWorkspaceAiKey(
  args: BaseArgs & { workspaceId: string; provider: string },
): Promise<WorkspaceAiConfigGql> {
  requireDeveloper(args.caller);
  if (!args.workspaceId) badRequest("workspaceId 필요");
  if (!isAiProvider(args.provider)) {
    badRequest(`지원하지 않는 provider: ${args.provider}`);
  }
  const provider = args.provider as AiProvider;
  const table = requireAiConfigTable(args.tables);
  const prev = await ensureGlobalAiConfigItem(args.doc, table, args.workspaceId);
  const keys = { ...resolveKeysMap(prev) };
  delete keys[provider];

  const remaining = providersWithKeys(keys);
  const nextDefault =
    remaining.length > 0
      ? pickDefaultModel({ ...prev, defaultModel: prev?.defaultModel }, keys)
      : AI_DEFAULT_MODEL_BY_PROVIDER.gemini;

  // keys 맵을 삭제 반영본으로 통째로 SET(setWorkspaceAiKey 와 동일한 이유 — 중첩 REMOVE
  // 는 부모 맵 부재 시 실패하고, 레거시 필드 REMOVE 만으로는 타 제공사 레거시 키가 유실됨).
  // 레거시 필드도 함께 정리. 키가 하나도 없으면 enabled=false.
  const r = await args.doc.send(
    new UpdateCommand({
      TableName: table,
      Key: { workspaceId: GLOBAL_AI_CONFIG_ID },
      UpdateExpression: remaining.length
        ? "SET #keys = :keys, defaultModel = :m, updatedAt = :t REMOVE apiKeyEnc, apiKeyLast4, #legacyProvider"
        : "SET #keys = :keys, enabled = :f, defaultModel = :m, updatedAt = :t REMOVE apiKeyEnc, apiKeyLast4, #legacyProvider",
      ExpressionAttributeNames: {
        "#keys": "keys",
        "#legacyProvider": "provider",
      },
      ExpressionAttributeValues: {
        ":keys": keys,
        ":m": nextDefault,
        ":t": new Date().toISOString(),
        ...(remaining.length ? {} : { ":f": false }),
      },
      ReturnValues: "ALL_NEW",
    }),
  );
  return aiConfigToGql(args.workspaceId, r.Attributes as AiConfigItem);
}

export async function updateWorkspaceAiSettings(
  args: BaseArgs & {
    workspaceId: string;
    enabled?: boolean | null;
    defaultModel?: string | null;
    monthlyTokenLimit?: number | null;
  },
): Promise<WorkspaceAiConfigGql> {
  requireDeveloper(args.caller);
  if (!args.workspaceId) badRequest("workspaceId 필요");

  const item = await ensureGlobalAiConfigItem(
    args.doc,
    requireAiConfigTable(args.tables),
    args.workspaceId,
  );
  const keys = resolveKeysMap(item);

  const sets: string[] = ["updatedAt = :t"];
  const values: Record<string, unknown> = { ":t": new Date().toISOString() };
  if (typeof args.enabled === "boolean") {
    if (args.enabled && providersWithKeys(keys).length === 0) {
      badRequest("API 키를 먼저 등록해야 합니다");
    }
    sets.push("enabled = :e");
    values[":e"] = args.enabled;
  }
  if (typeof args.defaultModel === "string") {
    const allowed = allowedModelsForKeys(keys);
    if (!allowed.includes(args.defaultModel)) {
      badRequest(`지원하지 않는 모델(또는 키 미등록 제공사): ${args.defaultModel}`);
    }
    sets.push("defaultModel = :m");
    values[":m"] = args.defaultModel;
  }
  if (typeof args.monthlyTokenLimit === "number") {
    if (
      !Number.isInteger(args.monthlyTokenLimit) ||
      args.monthlyTokenLimit < 0 ||
      args.monthlyTokenLimit > MAX_MONTHLY_TOKEN_LIMIT
    ) {
      badRequest("잘못된 월 토큰 한도");
    }
    sets.push("monthlyTokenLimit = :q");
    values[":q"] = args.monthlyTokenLimit;
  }

  const r = await args.doc.send(
    new UpdateCommand({
      TableName: requireAiConfigTable(args.tables),
      Key: { workspaceId: GLOBAL_AI_CONFIG_ID },
      UpdateExpression: `SET ${sets.join(", ")}`,
      ExpressionAttributeValues: values,
      ReturnValues: "ALL_NEW",
    }),
  );
  return aiConfigToGql(args.workspaceId, r.Attributes as AiConfigItem);
}
