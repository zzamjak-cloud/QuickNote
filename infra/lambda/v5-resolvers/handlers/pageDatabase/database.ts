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

type DatabaseTemplatesLww = {
  provided: boolean;
  shouldApply: boolean;
  changed: boolean;
  templates?: string;
  templatesUpdatedAt?: string;
};

function databaseTemplateTimestamp(raw: unknown, fallback: string): string {
  return typeof raw === "string" && raw.length > 0 ? raw : fallback;
}

function compareDatabaseTimestamps(left: string, right: string): number {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (Number.isFinite(leftMs) && Number.isFinite(rightMs)) {
    return leftMs === rightMs ? 0 : leftMs > rightMs ? 1 : -1;
  }
  return left === right ? 0 : left > right ? 1 : -1;
}

function databasePutCondition(
  existingItem: Record<string, unknown> | undefined,
  incomingUpdatedAt: string,
  staleGlobalWrite: boolean,
): {
  conditionExpression: string;
  expressionAttributeValues: Record<string, unknown>;
} {
  const expressionAttributeValues: Record<string, unknown> = {};
  let conditionExpression: string;
  if (staleGlobalWrite && existingItem) {
    conditionExpression = "updatedAt = :expectedUpdatedAt";
    expressionAttributeValues[":expectedUpdatedAt"] = existingItem.updatedAt;
  } else {
    conditionExpression = "attribute_not_exists(updatedAt) OR updatedAt <= :incomingUpdatedAt";
    expressionAttributeValues[":incomingUpdatedAt"] = incomingUpdatedAt;
  }

  const existingTemplatesUpdatedAt = existingItem?.templatesUpdatedAt;
  if (typeof existingTemplatesUpdatedAt === "string" && existingTemplatesUpdatedAt.length > 0) {
    conditionExpression = `(${conditionExpression}) AND templatesUpdatedAt = :expectedTemplatesUpdatedAt`;
    expressionAttributeValues[":expectedTemplatesUpdatedAt"] = existingTemplatesUpdatedAt;
  } else {
    conditionExpression = `(${conditionExpression}) AND attribute_not_exists(templatesUpdatedAt)`;
  }
  return { conditionExpression, expressionAttributeValues };
}

/**
 * templates는 배열 전체가 하나의 LWW 필드다. DB 구조 updatedAt과 독립된
 * templatesUpdatedAt으로 비교하며, 구형 클라이언트는 DB updatedAt을 폴백으로 쓴다.
 */
function resolveDatabaseTemplatesLww(
  input: Record<string, unknown>,
  existingItem: Record<string, unknown> | undefined,
  incomingUpdatedAt: string,
  existingUpdatedAt: string,
): DatabaseTemplatesLww {
  if (!("templates" in input)) {
    return { provided: false, shouldApply: false, changed: false };
  }

  const incomingTemplates = parseJsonArray(input.templates);
  if (!incomingTemplates) {
    return { provided: true, shouldApply: false, changed: false };
  }

  const incomingTemplatesUpdatedAt = databaseTemplateTimestamp(
    input.templatesUpdatedAt,
    incomingUpdatedAt,
  );
  const existingTemplatesUpdatedAt = databaseTemplateTimestamp(
    existingItem?.templatesUpdatedAt,
    existingUpdatedAt,
  );
  const shouldApply =
    !existingItem ||
    !existingTemplatesUpdatedAt ||
    !incomingTemplatesUpdatedAt ||
    compareDatabaseTimestamps(incomingTemplatesUpdatedAt, existingTemplatesUpdatedAt) >= 0;
  if (!shouldApply) {
    return { provided: true, shouldApply: false, changed: false };
  }

  const existingTemplates = parseJsonArray(existingItem?.templates) ?? [];
  const templates = JSON.stringify(incomingTemplates);
  const changed =
    !jsonEqual(existingTemplates, incomingTemplates) ||
    (incomingTemplatesUpdatedAt.length > 0 &&
      incomingTemplatesUpdatedAt !== existingItem?.templatesUpdatedAt);
  return {
    provided: true,
    shouldApply: true,
    changed,
    templates,
    ...(incomingTemplatesUpdatedAt
      ? { templatesUpdatedAt: incomingTemplatesUpdatedAt }
      : {}),
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

function incomingDatabaseFieldsStillWin(
  databaseId: string,
  input: Record<string, unknown>,
  latestItem: Record<string, unknown>,
  incomingUpdatedAt: string,
): boolean {
  const latestUpdatedAt =
    typeof latestItem.updatedAt === "string" ? latestItem.updatedAt : "";
  if (
    incomingUpdatedAt &&
    (!latestUpdatedAt || compareDatabaseTimestamps(incomingUpdatedAt, latestUpdatedAt) > 0)
  ) {
    return true;
  }

  const templatesLww = resolveDatabaseTemplatesLww(
    input,
    latestItem,
    incomingUpdatedAt,
    latestUpdatedAt,
  );
  if (templatesLww.shouldApply && templatesLww.changed) return true;

  return mergeStaleSchedulerMemberOrderPanelState(databaseId, input, latestItem) !== null;
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
  let existingItem = existing.Item as Record<string, unknown> | undefined;

  // templatesUpdatedAt CAS가 경합으로 실패하면 최신 레코드를 다시 읽어 한 번 재계산한다.
  // 이 재시도로 늦게 도착한 낮은 template 버전은 버리고, 더 높은 버전은 최신 구조 위에 반영한다.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const existingUpdatedAt =
      typeof existingItem?.updatedAt === "string" ? (existingItem.updatedAt as string) : "";
    const staleGlobalWrite = Boolean(
      existingItem &&
      existingUpdatedAt &&
      incomingUpdatedAt &&
      compareDatabaseTimestamps(incomingUpdatedAt, existingUpdatedAt) <= 0,
    );
    const templatesLww = resolveDatabaseTemplatesLww(
      args.input,
      existingItem,
      incomingUpdatedAt,
      existingUpdatedAt,
    );
    let nextItem: Record<string, unknown>;
    let shouldReconcileTemplates = false;

    if (staleGlobalWrite && existingItem) {
      const schedulerOrderMerge = mergeStaleSchedulerMemberOrderPanelState(
        id,
        args.input,
        existingItem,
      );
      nextItem = schedulerOrderMerge ?? existingItem;
      if (templatesLww.shouldApply && templatesLww.changed && templatesLww.templates !== undefined) {
        nextItem = {
          ...nextItem,
          templates: templatesLww.templates,
          ...(templatesLww.templatesUpdatedAt
            ? { templatesUpdatedAt: templatesLww.templatesUpdatedAt }
            : {}),
        };
        console.warn("[QN_TEMPLATE_SYNC] lambda upsertDatabase:staleTemplatesLww", {
          databaseId: id,
          workspaceId,
          incomingUpdatedAt,
          existingUpdatedAt,
          incomingTemplatesUpdatedAt: templatesLww.templatesUpdatedAt ?? null,
          existingTemplatesUpdatedAt:
            databaseTemplateTimestamp(existingItem.templatesUpdatedAt, existingUpdatedAt) || null,
        });
      }
      shouldReconcileTemplates = templatesLww.provided;
      if (nextItem === existingItem) {
        if (shouldReconcileTemplates) {
          await reconcileTemplateAutomationSchedules({
            before: existingItem,
            after: existingItem,
          });
        }
        return existingItem;
      }
    } else {
      // 부분 payload가 기존 필드(panelState 등)를 지우지 않도록 기존값 위에 병합한다.
      nextItem = {
        ...(existingItem ?? {}),
        ...args.input,
        createdAt: existingItem?.createdAt ?? args.input.createdAt,
        createdByMemberId:
          (existingItem?.createdByMemberId as string | undefined) ||
          (args.input.createdByMemberId as string | undefined) ||
          args.caller.memberId,
      };
      if (templatesLww.provided) {
        if (templatesLww.shouldApply && templatesLww.templates !== undefined) {
          nextItem.templates = templatesLww.templates;
          if (templatesLww.templatesUpdatedAt) {
            nextItem.templatesUpdatedAt = templatesLww.templatesUpdatedAt;
          } else {
            delete nextItem.templatesUpdatedAt;
          }
        } else if (existingItem) {
          nextItem.templates = existingItem.templates;
          if (existingItem.templatesUpdatedAt !== undefined) {
            nextItem.templatesUpdatedAt = existingItem.templatesUpdatedAt;
          } else {
            delete nextItem.templatesUpdatedAt;
          }
        } else {
          delete nextItem.templates;
          delete nextItem.templatesUpdatedAt;
        }
      } else if (existingItem) {
        // templates 없이 전역 DB만 갱신할 때 orphan timestamp 입력이 기존 버전을 바꾸지 않게 한다.
        if (existingItem.templatesUpdatedAt !== undefined) {
          nextItem.templatesUpdatedAt = existingItem.templatesUpdatedAt;
        } else {
          delete nextItem.templatesUpdatedAt;
        }
      } else {
        delete nextItem.templatesUpdatedAt;
      }
      shouldReconcileTemplates = true;
      if ("templates" in args.input) {
        console.warn("[QN_TEMPLATE_SYNC] lambda upsertDatabase:put", {
          databaseId: id,
          workspaceId,
          incomingUpdatedAt,
          existingUpdatedAt: existingUpdatedAt || null,
          templatesType: typeof nextItem.templates,
          templatesLength:
            typeof nextItem.templates === "string" ? nextItem.templates.length : null,
        });
      }
    }

    const putCondition = databasePutCondition(existingItem, incomingUpdatedAt, staleGlobalWrite);
    try {
      await args.doc.send(
        new PutCommand({
          TableName: tableName,
          Item: nextItem,
          ConditionExpression: putCondition.conditionExpression,
          ExpressionAttributeValues: putCondition.expressionAttributeValues,
        }),
      );
    } catch (err) {
      if ((err as { name?: string })?.name !== "ConditionalCheckFailedException") throw err;
      const latest = await args.doc.send(
        new GetCommand({ TableName: tableName, Key: { id } }),
      );
      const latestItem = latest.Item as Record<string, unknown> | undefined;
      if (attempt === 0 && latestItem) {
        existingItem = latestItem;
        continue;
      }
      // 두 번째 CAS 실패도 성공으로 반환하면 bridge가 outbox를 삭제한다. 최신 서버값 기준으로
      // 입력이 여전히 이겨야 하는 변경이면 조건 실패를 다시 던져 다음 flush에서 재시도한다.
      if (
        !latestItem ||
        incomingDatabaseFieldsStillWin(id, args.input, latestItem, incomingUpdatedAt)
      ) {
        throw err;
      }
      return latestItem;
    }

    try {
      await recordDatabaseHistory({
        doc: args.doc,
        tables: args.tables,
        caller: args.caller,
        before: existingItem ?? null,
        after:
          !staleGlobalWrite && incomingRowPageOrder
            ? { ...nextItem, rowPageOrder: incomingRowPageOrder }
            : nextItem,
        kind: existingItem ? "database.update" : "database.create",
      });
    } catch (err) {
      console.error("[upsertDatabase] DatabaseHistory 기록 실패 (무시)", err);
    }
    if (shouldReconcileTemplates) {
      await reconcileTemplateAutomationSchedules({
        before: existingItem ?? null,
        after: nextItem,
      });
    }
    return nextItem;
  }

  return existingItem ?? args.input;
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
