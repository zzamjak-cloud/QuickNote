// 드롭다운 메뉴·갤러리 공유 자원 AppSync 호출.
import { appsyncClient } from "./graphql/client";
import {
  GET_SHARED_BLOCK,
  UPSERT_SHARED_BLOCK,
  type GqlSharedBlock,
} from "./queries/sharedBlock";
import {
  parseSharedBlockData,
  serializeSharedBlockData,
  type SharedBlockKind,
  type SharedBlockRecord,
} from "../../types/sharedBlock";

function isKind(value: unknown): value is SharedBlockKind {
  return value === "dropdown-menu" || value === "gallery";
}

function gqlToRecord(value: GqlSharedBlock): SharedBlockRecord | null {
  if (!isKind(value.kind)) return null;
  const updatedAt = Date.parse(value.updatedAt);
  return {
    id: value.id,
    workspaceId: value.workspaceId,
    kind: value.kind,
    data: parseSharedBlockData(value.kind, value.data),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
    deletedAt: value.deletedAt ? Date.parse(value.deletedAt) || null : null,
  };
}

export async function fetchSharedBlockApi(
  id: string,
  workspaceId: string,
): Promise<SharedBlockRecord | null> {
  try {
    const result = (await appsyncClient().graphql({
      query: GET_SHARED_BLOCK,
      variables: { id, workspaceId },
    })) as { data?: { getSharedBlock?: GqlSharedBlock | null } };
    const value = result.data?.getSharedBlock;
    return value ? gqlToRecord(value) : null;
  } catch (error) {
    console.warn("[shared-block] fetch 실패(무시):", error);
    return null;
  }
}

export async function pushSharedBlockApi(
  record: SharedBlockRecord,
): Promise<SharedBlockRecord | null> {
  if (!record.workspaceId) return null;
  const iso = new Date(record.updatedAt).toISOString();
  try {
    const result = (await appsyncClient().graphql({
      query: UPSERT_SHARED_BLOCK,
      variables: {
        input: {
          id: record.id,
          workspaceId: record.workspaceId,
          kind: record.kind,
          data: serializeSharedBlockData(record.data),
          createdAt: iso,
          updatedAt: iso,
        },
      },
    })) as { data?: { upsertSharedBlock?: GqlSharedBlock | null } };
    const value = result.data?.upsertSharedBlock;
    return value ? gqlToRecord(value) : null;
  } catch (error) {
    console.warn("[shared-block] push 실패:", error);
    return null;
  }
}
