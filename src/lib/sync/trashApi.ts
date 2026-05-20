import { appsyncClient } from "./graphql/client";
import {
  EMPTY_TRASH,
  LIST_TRASHED_PAGES,
  RESTORE_PAGE,
  type GqlPage,
} from "./queries/page";
import { PERMANENTLY_DELETE_DATABASE } from "./queries/database";

const TRASH_BATCH_SIZE = 50;

export type TrashedPageBatch = {
  items: GqlPage[];
  /** null 이면 더 없음 */
  nextToken: string | null;
};

/** 휴지통 한 페이지(기본 50건). nextToken 으로 연속 조회 */
export async function fetchTrashedPagesBatch(
  workspaceId: string,
  nextToken?: string | null,
): Promise<TrashedPageBatch> {
  const r = (await appsyncClient().graphql({
    query: LIST_TRASHED_PAGES,
    variables: {
      workspaceId,
      limit: TRASH_BATCH_SIZE,
      nextToken: nextToken ?? null,
    },
  })) as {
    data: { listTrashedPages: { items: GqlPage[]; nextToken: string | null } };
  };
  const conn = r.data.listTrashedPages;
  return { items: conn.items, nextToken: conn.nextToken ?? null };
}

export async function restorePageRemote(
  id: string,
  workspaceId: string,
): Promise<GqlPage> {
  const r = (await appsyncClient().graphql({
    query: RESTORE_PAGE,
    variables: { id, workspaceId },
  })) as { data: { restorePage: GqlPage } };
  return r.data.restorePage;
}

export async function emptyTrashRemote(workspaceId: string): Promise<number> {
  const r = (await appsyncClient().graphql({
    query: EMPTY_TRASH,
    variables: { workspaceId },
  })) as {
    data: { emptyTrash: number } | null;
    errors?: Array<{ message?: string }>;
  };
  if (Array.isArray(r.errors) && r.errors.length > 0) {
    const message = r.errors
      .map((e) => e.message ?? "")
      .filter(Boolean)
      .join("; ");
    throw new Error(message || "emptyTrash GraphQL error");
  }
  return Number(r.data?.emptyTrash ?? 0);
}

export async function permanentlyDeleteDatabaseRemote(
  id: string,
  workspaceId: string,
): Promise<boolean> {
  const r = (await appsyncClient().graphql({
    query: PERMANENTLY_DELETE_DATABASE,
    variables: { id, workspaceId },
  })) as {
    data: { permanentlyDeleteDatabase: boolean } | null;
    errors?: Array<{ message?: string }>;
  };
  if (Array.isArray(r.errors) && r.errors.length > 0) {
    const message = r.errors
      .map((e) => e.message ?? "")
      .filter(Boolean)
      .join("; ");
    throw new Error(message || "permanentlyDeleteDatabase GraphQL error");
  }
  return Boolean(r.data?.permanentlyDeleteDatabase);
}
