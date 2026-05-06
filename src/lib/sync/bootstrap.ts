import { appsyncClient } from "./graphql/client";
import {
  LIST_PAGES,
  LIST_DATABASES,
  type GqlPage,
  type GqlDatabase,
} from "./graphql/operations";

// 첫 로그인 시 모든 페이지·DB·연락처를 페치. updatedAfter 로 증분 동기화.

const PAGE_LIMIT = 100;

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

export async function fetchDatabasesByWorkspace(
  workspaceId: string,
  updatedAfter?: string,
): Promise<GqlDatabase[]> {
  return paginate<GqlDatabase>(LIST_DATABASES, "listDatabases", {
    workspaceId,
    updatedAfter,
  });
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
