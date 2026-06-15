// upsertPage GraphQL input 단일 매퍼.
// 기존에 toGqlPage(pageStore) 와 enqueueUpsertPageRaw(databaseStore) 두 곳이
// input 객체를 각자 손으로 구성해 필드 누락(PageMeta 소실류) 회귀 위험이 있었다.
// 이 매퍼는 number(epoch ms) → ISO, order number → String,
// doc/dbCells → JSON.stringify 등 경계 변환을 한곳에 모은다.
//
// behavior-preserving: workspaceId/databaseId 해석과 dbCells 의 협업 제어는
// 호출처마다 로직이 다르므로(스케줄러 정규화 여부 등) 매퍼가 결정하지 않고
// 호출처가 이미 계산한 값을 opts 로 받아 그대로 싣는다.
// titleColor/coverImage/fullPageDatabaseId 포함 여부도 opts 로 분기해
// 각 호출처의 기존 출력 바이트를 정확히 유지한다.

import type { Page } from "../../../types/page";

export interface ToUpsertPageInputOpts {
  // 호출처가 해석한 workspaceId (스케줄러 스코프 등 호출처별 규칙 반영).
  workspaceId: string;
  // 호출처가 해석한 databaseId (toGqlPage 는 스케줄러 ID 정규화, raw 는 그대로).
  databaseId: string | null;
  // 직렬화·협업 제어를 마친 dbCells 최종 값.
  dbCells: string | null;
  // toGqlPage 경로 전용 메타 필드(titleColor, coverImage)를 포함할지.
  // raw 경로는 이 필드들을 보내지 않으므로 false/미지정.
  includeMetaColors?: boolean;
  // fullPageDatabaseId 를 값이 있을 때만 싣는다(toGqlPage 경로 전용).
  // raw 경로는 이 필드를 보내지 않으므로 false/미지정.
  includeFullPageDatabaseId?: boolean;
}

// AppSync AWSJSON 스칼라는 JSON 문자열을 요구한다 — 객체를 그대로 보내면
// 'Variable has an invalid value' 검증 오류로 mutation 이 거부된다.
export function toUpsertPageInput(
  p: Page,
  createdByMemberId: string,
  opts: ToUpsertPageInputOpts,
): Record<string, unknown> {
  const input: Record<string, unknown> = {
    id: p.id,
    workspaceId: opts.workspaceId,
    createdByMemberId,
    title: p.title,
  };
  // toGqlPage 경로의 키 순서(title 다음 titleColor, icon 다음 coverImage)를 보존한다.
  if (opts.includeMetaColors) input.titleColor = p.titleColor ?? null;
  input.icon = p.icon ?? null;
  if (opts.includeMetaColors) input.coverImage = p.coverImage ?? null;
  input.parentId = p.parentId ?? null;
  input.order = String(p.order);
  input.databaseId = opts.databaseId;
  input.doc = JSON.stringify(p.doc);
  input.dbCells = opts.dbCells;
  input.createdAt = new Date(p.createdAt).toISOString();
  input.updatedAt = new Date(p.updatedAt).toISOString();
  // 값이 있을 때만 싣는다 — 키 부재 시 서버가 기존 태그를 보존하므로,
  // 태그가 로컬에 없는(stale) 페이지의 재업서트가 서버 태그를 소거하지 못한다.
  if (opts.includeFullPageDatabaseId && p.fullPageDatabaseId != null) {
    input.fullPageDatabaseId = p.fullPageDatabaseId;
  }
  return input;
}
