import { appsyncClient } from "./graphql/client";
import {
  EMPTY_TRASH,
  LIST_TRASHED_PAGES_BRIEF,
  PERMANENTLY_DELETE_PAGE,
  RESTORE_PAGE,
  type GqlPage,
  type GqlPageBrief,
} from "./queries/page";
import {
  LIST_TRASHED_DATABASES,
  PERMANENTLY_DELETE_DATABASE,
  RESTORE_DATABASE,
  type GqlDatabase,
} from "./queries/database";

const TRASH_BATCH_SIZE = 50;

export type TrashedPageBatch = {
  items: GqlPageBrief[];
  /** null 이면 더 없음 */
  nextToken: string | null;
};

export type TrashedDatabaseBatch = {
  items: GqlDatabase[];
  /** null 이면 더 없음 */
  nextToken: string | null;
};

/**
 * 휴지통 한 페이지(기본 50건). nextToken 으로 연속 조회.
 * 리스트 표시에 필요한 최소 필드(id/title/icon/deletedAt)만 받음 — doc/blockComments
 * 같은 큰 페이로드 제외로 응답이 수십 배 빠르다. 복원 시 RESTORE_PAGE 가 전체 필드 반환.
 */
export async function fetchTrashedPagesBatch(
  workspaceId: string,
  nextToken?: string | null,
): Promise<TrashedPageBatch> {
  const r = (await appsyncClient().graphql({
    query: LIST_TRASHED_PAGES_BRIEF,
    variables: {
      workspaceId,
      limit: TRASH_BATCH_SIZE,
      nextToken: nextToken ?? null,
    },
  })) as {
    data: { listTrashedPages: { items: GqlPageBrief[]; nextToken: string | null } };
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

/** 삭제된 DB 한 배치(기본 50건). nextToken 으로 연속 조회. */
export async function fetchTrashedDatabasesBatch(
  workspaceId: string,
  nextToken?: string | null,
): Promise<TrashedDatabaseBatch> {
  const r = (await appsyncClient().graphql({
    query: LIST_TRASHED_DATABASES,
    variables: {
      workspaceId,
      limit: TRASH_BATCH_SIZE,
      nextToken: nextToken ?? null,
    },
  })) as {
    data: { listTrashedDatabases: { items: GqlDatabase[]; nextToken: string | null } };
  };
  const conn = r.data.listTrashedDatabases;
  return { items: conn.items, nextToken: conn.nextToken ?? null };
}

export async function restoreDatabaseRemote(
  id: string,
  workspaceId: string,
): Promise<GqlDatabase> {
  const r = (await appsyncClient().graphql({
    query: RESTORE_DATABASE,
    variables: { id, workspaceId },
  })) as { data: { restoreDatabase: GqlDatabase } };
  return r.data.restoreDatabase;
}

export async function emptyTrashRemote(workspaceId: string): Promise<number> {
  try {
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
      if (isResourceGoneMessage(message)) return 0;
      throw new Error(message || "emptyTrash GraphQL error");
    }
    return Number(r.data?.emptyTrash ?? 0);
  } catch (err) {
    const errorObj = err as { errors?: Array<{ message?: string }>; message?: string };
    const message =
      errorObj?.errors?.map((e) => e.message ?? "").filter(Boolean).join("; ") ??
      errorObj?.message ??
      String(err);
    if (isResourceGoneMessage(message)) return 0;
    throw err;
  }
}

function isResourceGoneMessage(message: string): boolean {
  const m = message.normalize("NFKC").toLowerCase();
  return (
    m.includes("리소스 없음")
    || (m.includes("리소스") && m.includes("없"))
    || m.includes("resource not found")
    || m.includes("no resource")
    || m.includes("not found")
  );
}

/**
 * 휴지통의 단일 페이지를 영구 삭제.
 * 휴지통 비우기를 청크 단위로 진행하면서 UI 에 진행률을 표시하기 위해 사용.
 */
export async function permanentlyDeletePageRemote(
  id: string,
  workspaceId: string,
): Promise<boolean> {
  try {
    const r = (await appsyncClient().graphql({
      query: PERMANENTLY_DELETE_PAGE,
      variables: { id, workspaceId },
    })) as {
      data: { permanentlyDeletePage: boolean } | null;
      errors?: Array<{ message?: string }>;
    };
    if (Array.isArray(r.errors) && r.errors.length > 0) {
      const message = r.errors
        .map((e) => e.message ?? "")
        .filter(Boolean)
        .join("; ");
      if (isResourceGoneMessage(message)) return true;
      throw new Error(message || "permanentlyDeletePage GraphQL error");
    }
    return Boolean(r.data?.permanentlyDeletePage);
  } catch (err) {
    const errorObj = err as { errors?: Array<{ message?: string }>; message?: string };
    const message =
      errorObj?.errors?.map((e) => e.message ?? "").filter(Boolean).join("; ") ??
      errorObj?.message ??
      String(err);
    if (isResourceGoneMessage(message)) return true;
    throw err;
  }
}

export async function permanentlyDeleteDatabaseRemote(
  id: string,
  workspaceId: string,
): Promise<boolean> {
  try {
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
      // 서버에서 이미 사라진 상태는 호출자 관점에서는 성공으로 간주.
      if (isResourceGoneMessage(message)) return true;
      throw new Error(message || "permanentlyDeleteDatabase GraphQL error");
    }
    return Boolean(r.data?.permanentlyDeleteDatabase);
  } catch (err) {
    const errorObj = err as { errors?: Array<{ message?: string }>; message?: string };
    const message =
      errorObj?.errors?.map((e) => e.message ?? "").filter(Boolean).join("; ") ??
      errorObj?.message ??
      String(err);
    if (isResourceGoneMessage(message)) return true;
    throw err;
  }
}
