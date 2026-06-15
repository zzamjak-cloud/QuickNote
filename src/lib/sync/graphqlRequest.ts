// GraphQL 읽기 호출의 공통 언랩 헬퍼.
//
// 읽기측 *Api.ts 들은 `appsyncClient().graphql({ query, variables })` 호출 후
// `as { data?: { op?: ... } }` 캐스트 → `data?.op` 언랩 → 없으면 throw(필수) 또는
// null/빈값 반환(선택) 하는 수동 패턴을 반복한다. 그 캐스트/언랩만 이 한곳에 모은다.
//
// 주의: GraphQL `errors` 배열을 검사하거나 응답을 무시(fire-and-forget)하는 호출은
// 동작이 달라 이 헬퍼 대상이 아니다. 단순 op 언랩 사이트만 흡수한다.

import { appsyncClient } from "./graphql/client";

/** raw 응답에서 `data[opName]` 을 꺼낸다. 호출 자체는 한곳에서만 수행. */
async function unwrap(
  query: string,
  variables: Record<string, unknown> | undefined,
  opName: string,
): Promise<unknown> {
  const raw = await appsyncClient().graphql({ query, variables: variables ?? {} });
  const data = (raw as { data?: Record<string, unknown> | null }).data;
  return data?.[opName];
}

/**
 * 필수 op 언랩. `data[opName]` 이 null/undefined 면 throw.
 * 기존 `if (!res.data?.op) throw ...` 사이트를 대체한다.
 */
export async function gqlRequired<T>(
  query: string,
  variables: Record<string, unknown> | undefined,
  opName: string,
): Promise<T> {
  const value = await unwrap(query, variables, opName);
  if (value === null || value === undefined) {
    throw new Error(`${opName} 응답 없음`);
  }
  return value as T;
}

/**
 * 선택 op 언랩. `data[opName]` 이 null/undefined 면 null 반환.
 * 기존 `res.data?.op ?? <fallback>` 사이트를 대체한다(호출자가 fallback 적용).
 */
export async function gqlOptional<T>(
  query: string,
  variables: Record<string, unknown> | undefined,
  opName: string,
): Promise<T | null> {
  const value = await unwrap(query, variables, opName);
  if (value === null || value === undefined) return null;
  return value as T;
}
