// DB 행 경로 — 행은 parentId 가 없어 조상 경로가 비므로 "DB 홈 페이지의 조상 / DB 제목" 으로 보여 준다.
// DB 레코드에는 부모 포인터가 없다. 풀페이지 DB 는 홈 페이지(fullPageDatabaseId 태그, 제목=DB 제목)로 위치를 찾고,
// 인라인 DB(호스트 페이지 본문의 databaseBlock)는 싼 역색인이 없어 DB 제목만 쓴다.
import type { McpContext } from "./context";
import { batchGetByKey } from "./ddb";
import { ancestorTitles, type PageMeta } from "./pageScan";

export async function databasePaths(
  ctx: McpContext,
  databaseIds: string[],
  metas: PageMeta[],
): Promise<Map<string, string[]>> {
  const ids = Array.from(new Set(databaseIds.filter(Boolean)));
  if (ids.length === 0) return new Map();
  const dbs = await batchGetByKey({ doc: ctx.doc, tableName: ctx.tables.Databases, keyName: "id", ids, projection: "id, title" });
  const titleById = new Map(dbs.map((d) => [String(d.id), String(d.title ?? "") || "Untitled"]));
  const titles = new Set(titleById.values());
  const candidates = metas.filter((m) => !m.databaseId && !m.deleted && titles.has(m.title));
  const tagged = candidates.length === 0 ? [] : await batchGetByKey({
    doc: ctx.doc, tableName: ctx.tables.Pages, keyName: "id", ids: candidates.map((m) => m.id),
    projection: "id, fullPageDatabaseId",
  });
  const homeByDb = new Map(tagged.filter((p) => p.fullPageDatabaseId).map((p) => [String(p.fullPageDatabaseId), String(p.id)]));
  const byId = new Map(metas.map((m) => [m.id, m]));
  const out = new Map<string, string[]>();
  for (const [dbId, title] of titleById) {
    const home = byId.get(homeByDb.get(dbId) ?? "");
    out.set(dbId, [...(home ? ancestorTitles(home, byId) : []), title]);
  }
  return out;
}

/**
 * 풀페이지 DB 홈 페이지 id(없으면 null). 홈은 DB 제목과 같은 제목으로 생성·동기화되므로(setDatabaseTitle) 같은 제목의
 * 루트 후보만 fullPageDatabaseId 로 확인한다(전체 페이지 본문을 읽지 않는다).
 */
export async function findDatabaseHomeId(ctx: McpContext, db: Record<string, unknown>, metas: PageMeta[]): Promise<string | null> {
  const title = String(db.title ?? "");
  const candidates = metas.filter((m) => !m.databaseId && !m.deleted && m.title === title);
  if (candidates.length === 0) return null;
  const tagged = await batchGetByKey({
    doc: ctx.doc, tableName: ctx.tables.Pages, keyName: "id", ids: candidates.map((m) => m.id),
    projection: "id, fullPageDatabaseId, deletedAt",
  });
  const home = tagged.find((p) => p.fullPageDatabaseId === db.id && !p.deletedAt);
  return home ? String(home.id) : null;
}
