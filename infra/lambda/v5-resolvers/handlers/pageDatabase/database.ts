import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  badRequest,
  forbidden,
  getLCSchedulerWorkspaceIdFromDatabaseId,
  isLCSchedulerDatabaseId,
  requireWorkspaceAccess,
  type Member,
} from "../_auth";
import type { Tables } from "../member";
import { reconcileTemplateAutomationSchedules } from "../templateAutomationScheduler";
import {
  type Connection,
  isPlainObject,
  jsonEqual,
  parseJsonLike,
  softDeleteRecord,
} from "./_shared";
import {
  recordDatabaseHistory,
  requireDatabaseHistoryOwnerKey,
} from "./history";

// 의미있는 dbCells(객체이고 키가 1개 이상)인지 — 빈 {}/null/비객체는 "내용 없음".
export function hasMeaningfulDbCells(value: unknown): boolean {
  const parsed = parseJsonLike(value);
  return isPlainObject(parsed) && Object.keys(parsed).length > 0;
}

// 서버 최후 방어선(dbCells) — doc 백스톤과 동형.
// 협업 ON DB 행 페이지는 셀 권위가 DB Y룸이라, 클라가 비-셀 업서트(본문 편집·주기 업서트)에서
// dbCells 를 null 로 비워 보낸다(helpers.ts). 서버가 그걸 그대로 저장하면 page.dbCells 가 상시
// null 로 비워져 ① 셀의 durable 영속처가 사라지고(Y룸 유실 시 복구 불가) ② 히스토리 스냅샷에
// 셀이 안 잡힌다. 들어온 dbCells 가 "건드리지 마"(키 부재/null)면 기존 셀을 보존한다.
// 권위적 셀 상태(객체 — 빈 {} 로 "모두 비움" 포함)는 그대로 적용해 셀 편집·비우기는 정상 동작한다.
export function preserveExistingDbCellsForNullInput(
  input: Record<string, unknown>,
  existingPage: Record<string, unknown> | null,
): void {
  if (!existingPage) return;
  // 권위적 셀(객체, 빈 {} 포함) 입력은 그대로 둔다.
  if ("dbCells" in input && input.dbCells != null) return;
  // 키 부재/null = "건드리지 마" → 기존 셀이 의미있으면 보존.
  if (hasMeaningfulDbCells(existingPage.dbCells)) {
    input.dbCells = existingPage.dbCells;
  }
}

export async function listDatabases(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  workspaceId: string;
  updatedAfter?: string;
  limit?: number;
  nextToken?: string;
}): Promise<Connection<Record<string, unknown>>> {
  if (!args.tables.Databases) badRequest("Databases table 미설정");
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "view",
  });
  const query = args.updatedAfter
    ? {
        expression: "workspaceId = :w AND updatedAt > :u",
        expressionValues: { ":w": args.workspaceId, ":u": args.updatedAfter },
      }
    : {
        expression: "workspaceId = :w",
        expressionValues: { ":w": args.workspaceId },
      };
  const r = await args.doc.send(
    new QueryCommand({
      TableName: args.tables.Databases,
      IndexName: "byWorkspaceAndUpdatedAt",
      KeyConditionExpression: query.expression,
      ExpressionAttributeValues: query.expressionValues,
      Limit: args.limit ?? 100,
      ExclusiveStartKey: args.nextToken ? JSON.parse(args.nextToken) : undefined,
    }),
  );
  return {
    items: (r.Items ?? []) as Record<string, unknown>[],
    nextToken: r.LastEvaluatedKey ? JSON.stringify(r.LastEvaluatedKey) : null,
  };
}

export async function getDatabase(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  id: string;
  workspaceId: string;
}): Promise<Record<string, unknown> | null> {
  if (!args.tables.Databases) badRequest("Databases table 미설정");
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "view",
  });
  const r = await args.doc.send(
    new GetCommand({ TableName: args.tables.Databases, Key: { id: args.id } }),
  );
  const item = r.Item as Record<string, unknown> | undefined;
  if (!item) return null;
  if (String(item["workspaceId"]) !== args.workspaceId) return null;
  return item;
}

/**
 * AppSync 가 AWSJSON 을 Lambda 에 **이미 파싱된 객체**로 넘기는 경우가 있어
 * 문자열뿐 아니라 plain object/array 를 받아 문자열로 정규화한다.
 * 클라이언트가 JSON 문자열로내도 동일하게 처리된다.
 */
function normalizeAwsJsonStringField(
  input: Record<string, unknown>,
  fieldName: string,
  label: string,
): void {
  const value = input[fieldName];
  if (value == null) return;

  if (typeof value === "string") return;
  if (typeof value !== "object") {
    badRequest(`${label} 는 JSON 객체·배열·문자열·null 이어야 합니다`);
  }

  try {
    input[fieldName] = JSON.stringify(value);
  } catch {
    badRequest(`${label} JSON 직렬화에 실패했습니다`);
  }
}

function normalizeDatabaseAwsJsonFields(input: Record<string, unknown>): void {
  normalizeAwsJsonStringField(input, "columns", "columns");
  normalizeAwsJsonStringField(input, "presets", "presets");
  normalizeAwsJsonStringField(input, "panelState", "panelState");
  normalizeAwsJsonStringField(input, "templates", "templates");
}

const MAX_SYNCED_SCHEDULER_MEMBER_ORDER = 1000;
const MAX_SYNCED_ID_CHARS = 128;

function parsePanelStateObject(raw: unknown): Record<string, unknown> | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return isPlainObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isPlainObject(raw) ? raw : null;
}

function sanitizeSyncedStringArray(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length > MAX_SYNCED_SCHEDULER_MEMBER_ORDER) {
    badRequest("동기화 목록 최대 개수 초과");
  }
  const result = raw.map(String);
  for (const id of result) {
    if (id.length > MAX_SYNCED_ID_CHARS) badRequest("동기화 ID 길이 초과");
  }
  return result;
}

function parseJsonArray(raw: unknown): unknown[] | null {
  if (raw == null || raw === "") return null;
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function templateIdOf(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const id = (value as Record<string, unknown>).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function mergeTemplateArrayById(existingRaw: unknown, incomingRaw: unknown): string | null {
  const incoming = parseJsonArray(incomingRaw);
  if (!incoming) return null;
  const existing = parseJsonArray(existingRaw) ?? [];
  const merged = [...existing];
  const indexById = new Map<string, number>();
  for (let index = 0; index < merged.length; index += 1) {
    const id = templateIdOf(merged[index]);
    if (id) indexById.set(id, index);
  }
  let changed = false;
  for (const template of incoming) {
    const id = templateIdOf(template);
    if (!id) continue;
    const existingIndex = indexById.get(id);
    if (existingIndex == null) {
      indexById.set(id, merged.length);
      merged.push(template);
      changed = true;
      continue;
    }
    if (!jsonEqual(merged[existingIndex], template)) {
      merged[existingIndex] = template;
      changed = true;
    }
  }
  return changed ? JSON.stringify(merged) : null;
}

function mergeStaleDatabaseTemplates(
  input: Record<string, unknown>,
  existingItem: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!("templates" in input)) return null;
  const templates = mergeTemplateArrayById(existingItem.templates, input.templates);
  if (!templates) return null;
  return {
    ...existingItem,
    templates,
  };
}

function mergeStaleSchedulerMemberOrderPanelState(
  databaseId: string,
  input: Record<string, unknown>,
  existingItem: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!isLCSchedulerDatabaseId(databaseId)) return null;

  const incomingPanelState = parsePanelStateObject(input.panelState);
  if (!incomingPanelState) return null;
  const incomingUpdatedAt = Number(incomingPanelState.schedulerMemberOrderUpdatedAt);
  if (!Number.isFinite(incomingUpdatedAt) || incomingUpdatedAt < 0) return null;

  const existingPanelState = parsePanelStateObject(existingItem.panelState) ?? {};
  const existingUpdatedAt = Number(existingPanelState.schedulerMemberOrderUpdatedAt);
  const currentUpdatedAt = Number.isFinite(existingUpdatedAt) ? existingUpdatedAt : -1;
  const incomingOrder = sanitizeSyncedStringArray(incomingPanelState.schedulerMemberOrder) ?? [];
  const existingOrder = sanitizeSyncedStringArray(existingPanelState.schedulerMemberOrder) ?? [];
  const shouldMerge =
    incomingUpdatedAt > currentUpdatedAt ||
    (incomingUpdatedAt === currentUpdatedAt && !jsonEqual(incomingOrder, existingOrder));
  if (!shouldMerge) return null;

  return {
    ...existingItem,
    panelState: JSON.stringify({
      ...existingPanelState,
      schedulerMemberOrder: incomingOrder,
      schedulerMemberOrderUpdatedAt: incomingUpdatedAt,
    }),
  };
}

export async function upsertDatabase(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  input: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  if (!args.tables.Databases) badRequest("Databases table 미설정");
  const id = typeof args.input.id === "string" ? args.input.id : "";
  const workspaceId = typeof args.input.workspaceId === "string" ? args.input.workspaceId : "";
  const schedulerWorkspaceId = getLCSchedulerWorkspaceIdFromDatabaseId(id);
  if (schedulerWorkspaceId && schedulerWorkspaceId !== workspaceId) {
    badRequest("LC스케줄러 DB ID와 워크스페이스가 일치하지 않습니다");
  }
  // rowPageOrder 는 Database 레코드에 저장하지 않는다(클라가 페이지의 databaseId 로 역추적).
  // 히스토리 스냅샷에만 싣기 위해 input 에서 분리·제거한 뒤, 아래 after 스냅샷에만 합친다.
  const incomingRowPageOrder = Array.isArray(args.input.rowPageOrder)
    ? (args.input.rowPageOrder as unknown[]).filter((v): v is string => typeof v === "string")
    : null;
  delete args.input.rowPageOrder;
  normalizeDatabaseAwsJsonFields(args.input);
  if ("templates" in args.input) {
    console.warn("[QN_TEMPLATE_SYNC] lambda upsertDatabase:input", {
      databaseId: id,
      workspaceId,
      updatedAt: args.input.updatedAt,
      templatesType: typeof args.input.templates,
      templatesLength:
        typeof args.input.templates === "string" ? args.input.templates.length : null,
    });
  }

  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId,
    required: "edit",
  });
  if (args.tables.DatabaseHistory) requireDatabaseHistoryOwnerKey(args.caller);

  const tableName = args.tables.Databases;
  const incomingUpdatedAt =
    typeof args.input.updatedAt === "string" ? args.input.updatedAt : "";

  // 기존 레코드 조회 — LWW 비교 및 부분 payload 병합(생략 필드 보존)용.
  const existing = await args.doc.send(
    new GetCommand({ TableName: tableName, Key: { id } }),
  );
  const existingItem = existing.Item as Record<string, unknown> | undefined;
  const existingUpdatedAt =
    typeof existingItem?.updatedAt === "string" ? (existingItem.updatedAt as string) : "";

  // LWW: 들어온 변경이 서버 최신값보다 오래됐거나 같으면 무시하고 기존값을 반환한다.
  // (ISO 8601 문자열은 사전식 비교 = 시간순 비교. 시드의 옛 타임스탬프·중복 echo 를 거른다.)
  if (existingItem && existingUpdatedAt && incomingUpdatedAt && incomingUpdatedAt <= existingUpdatedAt) {
    const schedulerOrderMerge = mergeStaleSchedulerMemberOrderPanelState(
      id,
      args.input,
      existingItem,
    );
    if (schedulerOrderMerge) {
      try {
        await args.doc.send(
          new PutCommand({
            TableName: tableName,
            Item: schedulerOrderMerge,
            ConditionExpression: "updatedAt = :existingUpdatedAt",
            ExpressionAttributeValues: { ":existingUpdatedAt": existingUpdatedAt },
          }),
        );
        try {
          await recordDatabaseHistory({
            doc: args.doc,
            tables: args.tables,
            caller: args.caller,
            before: existingItem,
            after: schedulerOrderMerge,
            kind: "database.update",
          });
        } catch (err) {
          console.error("[upsertDatabase] DatabaseHistory 기록 실패 (무시)", err);
        }
        return schedulerOrderMerge;
      } catch (err) {
        if ((err as { name?: string })?.name === "ConditionalCheckFailedException") {
          const latest = await args.doc.send(
            new GetCommand({ TableName: tableName, Key: { id } }),
          );
          return (latest.Item ?? existingItem) as Record<string, unknown>;
        }
        throw err;
      }
    }
    const templatesMerge = mergeStaleDatabaseTemplates(args.input, existingItem);
    if (templatesMerge) {
      console.warn("[QN_TEMPLATE_SYNC] lambda upsertDatabase:staleTemplatesMerge", {
        databaseId: id,
        workspaceId,
        incomingUpdatedAt,
        existingUpdatedAt,
      });
      try {
        await args.doc.send(
          new PutCommand({
            TableName: tableName,
            Item: templatesMerge,
            ConditionExpression: "updatedAt = :existingUpdatedAt",
            ExpressionAttributeValues: { ":existingUpdatedAt": existingUpdatedAt },
          }),
        );
        try {
          await recordDatabaseHistory({
            doc: args.doc,
            tables: args.tables,
            caller: args.caller,
            before: existingItem,
            after: templatesMerge,
            kind: "database.update",
          });
        } catch (err) {
          console.error("[upsertDatabase] DatabaseHistory 기록 실패 (무시)", err);
        }
        await reconcileTemplateAutomationSchedules({
          before: existingItem,
          after: templatesMerge,
        });
        return templatesMerge;
      } catch (err) {
        if ((err as { name?: string })?.name === "ConditionalCheckFailedException") {
          const latest = await args.doc.send(
            new GetCommand({ TableName: tableName, Key: { id } }),
          );
          return (latest.Item ?? existingItem) as Record<string, unknown>;
        }
        throw err;
      }
    }
    if ("templates" in args.input) {
      await reconcileTemplateAutomationSchedules({
        before: existingItem,
        after: existingItem,
      });
    }
    return existingItem;
  }

  // 부분 payload 가 기존 필드(panelState 등)를 지우지 않도록 기존값 위에 병합한다.
  // 과거 blind PutItem 은 panelState 가 생략되면 서버 표시설정을 통째로 삭제했다.
  const merged: Record<string, unknown> = {
    ...(existingItem ?? {}),
    ...args.input,
    // 최초 생성 메타는 보존한다.
    createdAt: existingItem?.createdAt ?? args.input.createdAt,
    createdByMemberId:
      (existingItem?.createdByMemberId as string | undefined) ||
      (args.input.createdByMemberId as string | undefined) ||
      args.caller.memberId,
  };
  if ("templates" in args.input) {
    console.warn("[QN_TEMPLATE_SYNC] lambda upsertDatabase:put", {
      databaseId: id,
      workspaceId,
      incomingUpdatedAt,
      existingUpdatedAt: existingUpdatedAt || null,
      templatesType: typeof merged.templates,
      templatesLength: typeof merged.templates === "string" ? merged.templates.length : null,
    });
  }

  try {
    await args.doc.send(
      new PutCommand({
        TableName: tableName,
        Item: merged,
        // 조회~쓰기 사이 경쟁 보호 — 그 사이 더 최신 쓰기가 들어왔으면 거부.
        ConditionExpression: "attribute_not_exists(updatedAt) OR updatedAt <= :incoming",
        ExpressionAttributeValues: { ":incoming": incomingUpdatedAt },
      }),
    );
  } catch (err) {
    if ((err as { name?: string })?.name === "ConditionalCheckFailedException") {
      // 경쟁 중 더 최신 쓰기가 선반영됨 → 최신 서버값을 반환(이 쓰기는 stale 로 폐기).
      const latest = await args.doc.send(
        new GetCommand({ TableName: tableName, Key: { id } }),
      );
      return (latest.Item ?? existingItem ?? merged) as Record<string, unknown>;
    }
    throw err;
  }
  try {
    await recordDatabaseHistory({
      doc: args.doc,
      tables: args.tables,
      caller: args.caller,
      before: existingItem ?? null,
      // rowPageOrder 는 레코드(merged)에는 없고 히스토리 스냅샷에만 포함시킨다.
      after: incomingRowPageOrder ? { ...merged, rowPageOrder: incomingRowPageOrder } : merged,
      kind: existingItem ? "database.update" : "database.create",
    });
  } catch (err) {
    console.error("[upsertDatabase] DatabaseHistory 기록 실패 (무시)", err);
  }
  await reconcileTemplateAutomationSchedules({
    before: existingItem ?? null,
    after: merged,
  });
  return merged;
}

export async function softDeleteDatabase(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  id: string;
  workspaceId: string;
  updatedAt: string;
}): Promise<Record<string, unknown>> {
  if (!args.tables.Databases) badRequest("Databases table 미설정");
  if (isLCSchedulerDatabaseId(args.id)) {
    forbidden("LC스케줄러 데이터베이스는 삭제할 수 없습니다");
  }
  if (args.tables.DatabaseHistory) requireDatabaseHistoryOwnerKey(args.caller);
  const existing = await args.doc.send(
    new GetCommand({ TableName: args.tables.Databases, Key: { id: args.id } }),
  );
  const before = (existing.Item as Record<string, unknown> | undefined) ?? null;
  const deleted = await softDeleteRecord({ ...args, tableName: args.tables.Databases });
  try {
    await recordDatabaseHistory({
      doc: args.doc,
      tables: args.tables,
      caller: args.caller,
      before,
      after: deleted,
      kind: "database.delete",
    });
  } catch (err) {
    console.error("[softDeleteDatabase] DatabaseHistory 기록 실패 (무시)", err);
  }
  return deleted;
}
