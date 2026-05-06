import { appsyncClient } from "./graphql/client";
import {
  LIST_PAGES,
  LIST_DATABASES,
  LIST_CONTACTS,
  type GqlPage,
  type GqlDatabase,
  type GqlContact,
} from "./graphql/operations";

// 첫 로그인 시 모든 페이지·DB·연락처를 페치. updatedAfter 로 증분 동기화.

const PAGE_LIMIT = 100;

export async function fetchAllPages(updatedAfter?: string): Promise<GqlPage[]> {
  return paginate<GqlPage>(LIST_PAGES, "listPages", { updatedAfter });
}
export async function fetchAllDatabases(
  updatedAfter?: string,
): Promise<GqlDatabase[]> {
  return paginate<GqlDatabase>(LIST_DATABASES, "listDatabases", {
    updatedAfter,
  });
}
export async function fetchAllContacts(): Promise<GqlContact[]> {
  return paginate<GqlContact>(LIST_CONTACTS, "listContacts", {});
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
