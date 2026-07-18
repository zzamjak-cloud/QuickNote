// 드롭다운 메뉴·갤러리 공유 블록 자원 리졸버.
// sharedBlockId 하나를 여러 페이지가 참조하며 updatedAt(ISO) LWW 로 최신 data 를 공유한다.
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
  UpdateCommand,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { badRequest, requireWorkspaceAccess, type Member } from "./_auth";
import type { Tables } from "./member";

const ID_RE = /^[A-Za-z0-9:._-]{1,128}$/;
const ASSET_ID_RE = /^[A-Za-z0-9:._-]{1,256}$/;
const SHARED_BLOCK_KINDS = new Set(["dropdown-menu", "gallery"]);
const GALLERY_IMAGE_MAX = 50;
const USAGE_TRACKED_FIELD = "usageTrackedAssetIds";

type SharedBlockItem = Record<string, unknown> & {
  id?: string;
  workspaceId?: string;
  kind?: string;
  data?: unknown;
  updatedAt?: string;
  deletedAt?: string | null;
  usageTrackedAssetIds?: Set<string> | string[];
};
type UsageMutation = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];

function normalizeData(kind: string, value: unknown): string {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      badRequest("data 는 유효한 JSON 이어야 합니다");
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    badRequest("data 는 JSON 객체여야 합니다");
  }
  const dataKind = (parsed as Record<string, unknown>).kind;
  if (dataKind !== kind) {
    badRequest("kind 와 data.kind 가 일치해야 합니다");
  }
  return JSON.stringify(parsed);
}

function validateIdentity(id: string, workspaceId: string): void {
  if (!ID_RE.test(id) || !ID_RE.test(workspaceId)) {
    badRequest("id/workspaceId 형식이 올바르지 않습니다");
  }
}

function objectValue(raw: unknown): Record<string, unknown> | null {
  let value = raw;
  for (let i = 0; i < 2 && typeof value === "string"; i += 1) {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function galleryAssetIds(data: unknown, deletedAt?: unknown): Set<string> {
  if (typeof deletedAt === "string" && deletedAt) return new Set();
  const value = objectValue(data);
  if (value?.kind !== "gallery") return new Set();
  const images = Array.isArray(value.images) ? value.images.slice(0, GALLERY_IMAGE_MAX) : [];
  const ids = new Set<string>();
  for (const raw of images) {
    const image = objectValue(raw);
    const src = typeof image?.src === "string" ? image.src : "";
    const prefix = src.startsWith("quicknote-image://")
      ? "quicknote-image://"
      : src.startsWith("quicknote-file://")
        ? "quicknote-file://"
        : null;
    if (!prefix) continue;
    const assetId = src.slice(prefix.length).split(/[?#]/, 1)[0] ?? "";
    if (ASSET_ID_RE.test(assetId)) ids.add(assetId);
  }
  return ids;
}

function trackedAssetIds(item: SharedBlockItem | undefined): Set<string> {
  const raw = item?.[USAGE_TRACKED_FIELD];
  if (raw instanceof Set) {
    return new Set(Array.from(raw).filter((id): id is string => typeof id === "string" && ASSET_ID_RE.test(id)));
  }
  if (Array.isArray(raw)) {
    return new Set(raw.filter((id): id is string => typeof id === "string" && ASSET_ID_RE.test(id)));
  }
  // 기능 도입 전 저장된 갤러리도 첫 수정에서 안전하게 정리할 수 있도록 기존 data를 폴백한다.
  return galleryAssetIds(item?.data, item?.deletedAt);
}

function sharedUsageSk(workspaceId: string, sharedBlockId: string): string {
  // PAGE#/CUSTOM_ICON#/WS# 네임스페이스와 분리해 기존 사용처 키와 충돌하지 않는다.
  return `SHARED_BLOCK#${workspaceId}#${sharedBlockId}`;
}

function sharedUsagePageId(workspaceId: string, sharedBlockId: string): string {
  // GraphQL AssetUsage.pageId non-null 계약을 지키되 blockType으로 페이지 cascade와 분리한다.
  return `__sharedBlock__:${workspaceId}:${sharedBlockId}`;
}

async function ownedAssetIds(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  assetIds: ReadonlySet<string>;
  ownerId: string;
}): Promise<Set<string>> {
  const tableName = args.tables.ImageAssets;
  if (!tableName || args.assetIds.size === 0) return new Set();
  const ids = Array.from(args.assetIds);
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const result = await args.doc.send(new BatchGetCommand({
      RequestItems: {
        [tableName]: {
          Keys: ids.slice(i, i + 100).map((id) => ({ id })),
          ProjectionExpression: "id, ownerId",
        },
      },
    }));
    for (const item of result.Responses?.[tableName] ?? []) {
      if (item.ownerId === args.ownerId && typeof item.id === "string") out.add(item.id);
    }
  }
  return out;
}

async function reconcileSharedGalleryUsage(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  item: SharedBlockItem;
  ownerId: string;
  currentAssetIds: ReadonlySet<string>;
  putAssetIds: ReadonlySet<string>;
}): Promise<boolean> {
  const usageTable = args.tables.AssetUsage;
  const sharedTable = args.tables.SharedBlocks;
  const id = args.item.id;
  const workspaceId = args.item.workspaceId;
  const updatedAt = args.item.updatedAt;
  if (!usageTable || !sharedTable || !id || !workspaceId || !updatedAt) return true;

  const tracked = trackedAssetIds(args.item);
  for (const assetId of args.currentAssetIds) tracked.add(assetId);
  const mutations: UsageMutation[] = [];
  for (const assetId of tracked) {
    if (!args.currentAssetIds.has(assetId)) {
      mutations.push({
        Delete: {
          TableName: usageTable,
          Key: { assetId, sk: sharedUsageSk(workspaceId, id) },
        },
      });
      continue;
    }
    // 다른 구성원이 올린 기존 워크스페이스 자산은 row를 덮어쓰지 않아 원 소유자의
    // byOwner 인덱스를 보존한다. 새로/재시도해 PUT할 수 있는 것은 현재 호출자 소유 자산뿐이다.
    if (!args.putAssetIds.has(assetId)) continue;
    mutations.push({
      Put: {
        TableName: usageTable,
        Item: {
          assetId,
          sk: sharedUsageSk(workspaceId, id),
          ownerId: args.ownerId,
          pageId: sharedUsagePageId(workspaceId, id),
          blockId: id,
          blockType: "sharedGallery",
          workspaceId,
          pageTitle: "공유 갤러리",
          sharedBlockId: id,
          updatedAt,
        },
      },
    });
  }

  try {
    // 트랜잭션 한 건당 ConditionCheck 1개 + usage mutation 최대 24개.
    // 모든 청크가 같은 최신 SharedBlock 버전을 확인하므로 오래된 편집의 지연 쓰기는 차단된다.
    for (let i = 0; i < mutations.length; i += 24) {
      await args.doc.send(new TransactWriteCommand({
        TransactItems: [
          {
            ConditionCheck: {
              TableName: sharedTable,
              Key: { id },
              ConditionExpression: "#workspaceId = :workspaceId AND #updatedAt = :updatedAt",
              ExpressionAttributeNames: {
                "#workspaceId": "workspaceId",
                "#updatedAt": "updatedAt",
              },
              ExpressionAttributeValues: {
                ":workspaceId": workspaceId,
                ":updatedAt": updatedAt,
              },
            },
          },
          ...mutations.slice(i, i + 24),
        ],
      }));
    }

    if (tracked.size > 0 || USAGE_TRACKED_FIELD in args.item) {
      const hasCurrent = args.currentAssetIds.size > 0;
      await args.doc.send(new UpdateCommand({
        TableName: sharedTable,
        Key: { id },
        UpdateExpression: hasCurrent
          ? `SET #${USAGE_TRACKED_FIELD} = :current`
          : `REMOVE #${USAGE_TRACKED_FIELD}`,
        ConditionExpression: "#workspaceId = :workspaceId AND #updatedAt = :updatedAt",
        ExpressionAttributeNames: {
          [`#${USAGE_TRACKED_FIELD}`]: USAGE_TRACKED_FIELD,
          "#workspaceId": "workspaceId",
          "#updatedAt": "updatedAt",
        },
        ExpressionAttributeValues: {
          ...(hasCurrent ? { ":current": new Set(args.currentAssetIds) } : {}),
          ":workspaceId": workspaceId,
          ":updatedAt": updatedAt,
        },
      }));
    }
    return true;
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === "ConditionalCheckFailedException") {
      return false;
    }
    if (name === "TransactionCanceledException") {
      // TransactionCanceled는 조건 경합 외에 용량/충돌 원인도 포함한다. 최신 버전이 실제로
      // 바뀐 경우만 LWW 패배로 처리하고, 같은 버전이면 오류를 전파해 호출자 재시도를 유도한다.
      const current = await args.doc.send(new GetCommand({
        TableName: sharedTable,
        Key: { id },
        ProjectionExpression: "workspaceId, updatedAt",
      }));
      if (
        current.Item?.workspaceId !== workspaceId ||
        current.Item?.updatedAt !== updatedAt
      ) {
        return false;
      }
    }
    throw error;
  }
}

export async function getSharedBlock(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  id: string;
  workspaceId: string;
}): Promise<Record<string, unknown> | null> {
  const tableName = args.tables.SharedBlocks;
  if (!tableName) badRequest("SharedBlocks table 미설정");
  validateIdentity(args.id, args.workspaceId);
  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId: args.workspaceId,
    required: "view",
  });
  const result = await args.doc.send(
    new GetCommand({ TableName: tableName, Key: { id: args.id } }),
  );
  const item = result.Item as Record<string, unknown> | undefined;
  if (!item || item.workspaceId !== args.workspaceId) return null;
  return item;
}

export async function upsertSharedBlock(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  input: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const tableName = args.tables.SharedBlocks;
  if (!tableName) badRequest("SharedBlocks table 미설정");
  const id = typeof args.input.id === "string" ? args.input.id : "";
  const workspaceId =
    typeof args.input.workspaceId === "string" ? args.input.workspaceId : "";
  const kind = typeof args.input.kind === "string" ? args.input.kind : "";
  const createdAt =
    typeof args.input.createdAt === "string" ? args.input.createdAt : "";
  const updatedAt =
    typeof args.input.updatedAt === "string" ? args.input.updatedAt : "";
  validateIdentity(id, workspaceId);
  if (!SHARED_BLOCK_KINDS.has(kind)) {
    badRequest('kind 는 "dropdown-menu" 또는 "gallery" 여야 합니다');
  }
  if (!createdAt || !updatedAt) badRequest("createdAt/updatedAt 필요");
  const data = normalizeData(kind, args.input.data);
  const requestedAssetIds = galleryAssetIds(data, args.input.deletedAt);
  if (requestedAssetIds.size > 0 && !args.caller.cognitoSub) {
    badRequest("갤러리 자산 사용처 기록에 cognitoSub가 필요합니다");
  }

  await requireWorkspaceAccess({
    doc: args.doc,
    memberTeamsTableName: args.tables.MemberTeams,
    workspaceAccessTableName: args.tables.WorkspaceAccess,
    caller: args.caller,
    workspaceId,
    required: "edit",
  });

  const existingResult = await args.doc.send(
    new GetCommand({ TableName: tableName, Key: { id } }),
  );
  const existing = existingResult.Item as SharedBlockItem | undefined;
  if (existing && existing.workspaceId !== workspaceId) {
    badRequest("다른 워크스페이스의 공유 블록 ID 입니다");
  }
  const existingUpdatedAt =
    typeof existing?.updatedAt === "string" ? existing.updatedAt : "";
  if (existingUpdatedAt && updatedAt < existingUpdatedAt) return existing!;

  const ownerId = args.caller.cognitoSub ?? "";
  const ownedRequested = ownerId
    ? await ownedAssetIds({
        doc: args.doc,
        tables: args.tables,
        assetIds: requestedAssetIds,
        ownerId,
      })
    : new Set<string>();

  if (existingUpdatedAt && updatedAt === existingUpdatedAt) {
    const currentRefs = galleryAssetIds(existing?.data, existing?.deletedAt);
    const allowedCurrent = new Set(Array.from(currentRefs).filter((id) =>
      trackedAssetIds(existing).has(id) || ownedRequested.has(id),
    ));
    const reconciled = await reconcileSharedGalleryUsage({
      doc: args.doc,
      tables: args.tables,
      item: existing!,
      ownerId,
      currentAssetIds: allowedCurrent,
      putAssetIds: ownedRequested,
    });
    if (reconciled) return existing!;
    const winner = await args.doc.send(new GetCommand({ TableName: tableName, Key: { id } }));
    return (winner.Item as Record<string, unknown> | undefined) ?? existing!;
  }

  const trackedBefore = trackedAssetIds(existing);
  const carryTracked = new Set([...trackedBefore, ...ownedRequested]);
  const item: SharedBlockItem = {
    id,
    workspaceId,
    kind,
    data,
    createdAt:
      typeof existing?.createdAt === "string" ? existing.createdAt : createdAt,
    updatedAt,
    deletedAt:
      typeof args.input.deletedAt === "string" ? args.input.deletedAt : null,
  };

  try {
    const hasTracked = carryTracked.size > 0;
    const saved = await args.doc.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { id },
        UpdateExpression: [
          "SET #workspaceId = :workspaceId, #kind = :kind, #data = :data,",
          "#createdAt = if_not_exists(#createdAt, :createdAt), #updatedAt = :updatedAt, #deletedAt = :deletedAt",
          hasTracked ? `ADD #${USAGE_TRACKED_FIELD} :tracked` : "",
        ].filter(Boolean).join(" "),
        ConditionExpression:
          "attribute_not_exists(#id) OR (#workspaceId = :workspaceId AND (attribute_not_exists(#updatedAt) OR #updatedAt < :updatedAt))",
        ExpressionAttributeNames: {
          "#id": "id",
          "#workspaceId": "workspaceId",
          "#kind": "kind",
          "#data": "data",
          "#createdAt": "createdAt",
          "#updatedAt": "updatedAt",
          "#deletedAt": "deletedAt",
          ...(hasTracked ? { [`#${USAGE_TRACKED_FIELD}`]: USAGE_TRACKED_FIELD } : {}),
        },
        ExpressionAttributeValues: {
          ":workspaceId": workspaceId,
          ":kind": kind,
          ":data": data,
          ":createdAt": createdAt,
          ":updatedAt": updatedAt,
          ":deletedAt": item.deletedAt,
          ...(hasTracked ? { ":tracked": carryTracked } : {}),
        },
        ReturnValues: "ALL_NEW",
      }),
    );
    const savedItem = (saved.Attributes as SharedBlockItem | undefined) ?? {
      ...item,
      ...(hasTracked ? { [USAGE_TRACKED_FIELD]: carryTracked } : {}),
    };
    const currentRefs = galleryAssetIds(savedItem.data, savedItem.deletedAt);
    const savedTracked = trackedAssetIds(savedItem);
    const allowedCurrent = new Set(Array.from(currentRefs).filter((assetId) =>
      savedTracked.has(assetId) || ownedRequested.has(assetId),
    ));
    const reconciled = await reconcileSharedGalleryUsage({
      doc: args.doc,
      tables: args.tables,
      item: savedItem,
      ownerId,
      currentAssetIds: allowedCurrent,
      putAssetIds: ownedRequested,
    });
    if (reconciled) return item;
    const winnerResult = await args.doc.send(
      new GetCommand({ TableName: tableName, Key: { id } }),
    );
    return (winnerResult.Item as Record<string, unknown> | undefined) ?? item;
  } catch (error) {
    if ((error as { name?: string }).name !== "ConditionalCheckFailedException") {
      throw error;
    }
    const winnerResult = await args.doc.send(
      new GetCommand({ TableName: tableName, Key: { id } }),
    );
    const winner = winnerResult.Item as Record<string, unknown> | undefined;
    if (!winner || winner.workspaceId !== workspaceId) {
      badRequest("공유 블록을 저장할 수 없습니다");
    }
    return winner;
  }
}
