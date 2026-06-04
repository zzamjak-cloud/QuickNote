import { appsyncClient } from "./graphql/client";
import {
  GET_DATABASE,
  GET_PAGE,
  LIST_DATABASE_ROWS,
  LIST_PAGE_METAS,
  LIST_PAGES,
  LIST_DATABASES,
  type GqlPage,
  type GqlPageMeta,
  type GqlDatabase,
} from "./graphql/operations";

// 첫 로그인 시 모든 페이지·DB·연락처를 페치. updatedAfter 로 증분 동기화.

const PAGE_LIMIT = 100;

export type GqlConnection<T> = {
  items: T[];
  nextToken: string | null;
};

export async function fetchAllPages(_updatedAfter?: string): Promise<GqlPage[]> {
  throw new Error("workspaceId required. use fetchPagesByWorkspace(workspaceId, updatedAfter)");
}
export async function fetchAllDatabases(
  _updatedAfter?: string,
): Promise<GqlDatabase[]> {
  throw new Error("workspaceId required. use fetchDatabasesByWorkspace(workspaceId, updatedAfter)");
}
export async function fetchPagesByWorkspace(
  workspaceId: string,
  updatedAfter?: string,
): Promise<GqlPage[]> {
  return paginate<GqlPage>(LIST_PAGES, "listPages", { workspaceId, updatedAfter });
}

export async function fetchPageMetasBatch(args: {
  workspaceId: string;
  updatedAfter?: string;
  limit?: number;
  nextToken?: string | null;
}): Promise<GqlConnection<GqlPageMeta>> {
  const r = (await appsyncClient().graphql({
    query: LIST_PAGE_METAS,
    variables: {
      workspaceId: args.workspaceId,
      updatedAfter: args.updatedAfter,
      limit: args.limit ?? PAGE_LIMIT,
      nextToken: args.nextToken ?? null,
    },
  })) as { data: { listPageMetas: GqlConnection<GqlPageMeta> } };
  return r.data.listPageMetas;
}

export async function fetchPageMetasByWorkspace(
  workspaceId: string,
  updatedAfter?: string,
  onBatch?: (items: GqlPageMeta[], isFirst: boolean) => void,
): Promise<GqlPageMeta[]> {
  if (onBatch) {
    return paginateWithCallback<GqlPageMeta>(
      LIST_PAGE_METAS,
      "listPageMetas",
      { workspaceId, updatedAfter },
      onBatch,
    );
  }
  return paginate<GqlPageMeta>(LIST_PAGE_METAS, "listPageMetas", {
    workspaceId,
    updatedAfter,
  });
}

export async function fetchDatabasesByWorkspace(
  workspaceId: string,
  updatedAfter?: string,
): Promise<GqlDatabase[]> {
  return paginate<GqlDatabase>(LIST_DATABASES, "listDatabases", {
    workspaceId,
    updatedAfter,
  });
}

export async function fetchPageById(
  workspaceId: string,
  id: string,
): Promise<GqlPage | null> {
  const r = (await appsyncClient().graphql({
    query: GET_PAGE,
    variables: { workspaceId, id },
  })) as { data: { getPage: GqlPage | null } };
  return r.data.getPage ?? null;
}

export async function fetchDatabaseById(
  workspaceId: string,
  id: string,
): Promise<GqlDatabase | null> {
  const r = (await appsyncClient().graphql({
    query: GET_DATABASE,
    variables: { workspaceId, id },
  })) as { data: { getDatabase: GqlDatabase | null } };
  return r.data.getDatabase ?? null;
}

export async function fetchDatabaseRowsBatch(args: {
  workspaceId: string;
  databaseId: string;
  limit?: number;
  nextToken?: string | null;
}): Promise<GqlConnection<GqlPage>> {
  const r = (await appsyncClient().graphql({
    query: LIST_DATABASE_ROWS,
    variables: {
      workspaceId: args.workspaceId,
      databaseId: args.databaseId,
      limit: args.limit ?? PAGE_LIMIT,
      nextToken: args.nextToken ?? null,
    },
  })) as { data: { listDatabaseRows: GqlConnection<GqlPage> } };
  return r.data.listDatabaseRows;
}

async function paginate<T>(
  query: string,
  root: string,
  vars: Record<string, unknown>,
): Promise<T[]> {
  const out: T[] = [];
  let nextToken: string | null = null;
  do {
    const r = (await appsyncClient().graphql({
      query,
      variables: { ...vars, limit: PAGE_LIMIT, nextToken },
    })) as { data: Record<string, { items: T[]; nextToken: string | null }> };
    out.push(...r.data[root]!.items);
    nextToken = r.data[root]!.nextToken ?? null;
  } while (nextToken);
  return out;
}

async function paginateWithCallback<T>(
  query: string,
  root: string,
  vars: Record<string, unknown>,
  onBatch: (items: T[], isFirst: boolean) => void,
): Promise<T[]> {
  const out: T[] = [];
  let nextToken: string | null = null;
  let isFirst = true;
  do {
    const r = (await appsyncClient().graphql({
      query,
      variables: { ...vars, limit: PAGE_LIMIT, nextToken },
    })) as { data: Record<string, { items: T[]; nextToken: string | null }> };
    const items = r.data[root]!.items;
    out.push(...items);
    nextToken = r.data[root]!.nextToken ?? null;
    onBatch(items, isFirst);
    isFirst = false;
  } while (nextToken);
  return out;
}
