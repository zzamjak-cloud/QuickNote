// 즐겨찾기 — Members.clientPrefs(favoritePageIds·favoritePageMetaById, 타임스탬프 LWW)를 v5 updateMyClientPrefs 로 갱신한다.
// 앱은 부팅·재동기화 때 서버 prefs 가 더 새로우면 적용하므로(clientPrefsSync.applyRemoteClientPrefs) 타임스탬프를 기존보다 크게 둔다.
// 토큰 범위 밖 워크스페이스의 즐겨찾기는 목록에서 빼고 제거도 거부한다(항목은 보존).
import { z } from "zod";
import { updateMyClientPrefs } from "../../../v5-resolvers/handlers/member";
import { NOT_ACCESSIBLE, requireWorkspace } from "../../access";
import { ToolError, type McpContext } from "../../context";
import { batchGetByKey, getItem } from "../../ddb";
import { requireWriteScope } from "../../writeAccess";
import { idInput } from "../history/shared";
import { workspaceVisibility } from "./shared";

type Item = Record<string, unknown>;

/** v5 updateMyClientPrefs 의 즐겨찾기 상한. */
export const MAX_FAVORITES = 500;

type Favorites = { ids: string[]; updatedAt: number; meta: Record<string, Item> };

function parsePrefs(raw: unknown): Favorites {
  const empty: Favorites = { ids: [], updatedAt: 0, meta: {} };
  if (raw == null || raw === "") return empty;
  try {
    const o = (typeof raw === "string" ? JSON.parse(raw) : raw) as Item;
    if (!o || typeof o !== "object" || !Array.isArray(o.favoritePageIds)) return empty;
    const ts = Number(o.favoritePageIdsUpdatedAt);
    const meta = o.favoritePageMetaById && typeof o.favoritePageMetaById === "object" ? (o.favoritePageMetaById as Record<string, Item>) : {};
    return { ids: o.favoritePageIds.map(String), updatedAt: Number.isFinite(ts) ? ts : 0, meta };
  } catch {
    return empty;
  }
}

/** 캐시된 ctx.caller 대신 최신 Members 행에서 읽는다(앱이 그 사이 바꿨을 수 있다). */
async function readFavorites(ctx: McpContext): Promise<Favorites> {
  const row = await getItem(ctx.doc, ctx.tables.Members, { memberId: ctx.caller.memberId });
  return parsePrefs(row?.clientPrefs);
}

/** 즐겨찾기 목록만 바꾼다 — fullWidth 등 다른 prefs 는 타임스탬프를 보내지 않아 서버 병합에서 그대로 남는다. */
async function saveFavorites(ctx: McpContext, prev: Favorites, ids: string[], meta: Record<string, Item>): Promise<void> {
  const keptMeta = Object.fromEntries(ids.filter((id) => meta[id]).map((id) => [id, meta[id]]));
  const payload = {
    v: 1,
    favoritePageIds: ids,
    favoritePageIdsUpdatedAt: Math.max(Date.now(), prev.updatedAt + 1),
    favoritePageMetaById: keptMeta,
  };
  // Members 쓰기 IAM 이 clientPrefs 속성으로 제한돼 있어 ALL_NEW 반환은 거부된다.
  await updateMyClientPrefs({
    doc: ctx.doc, tables: ctx.tables, caller: ctx.caller, input: { clientPrefs: JSON.stringify(payload) }, returnValues: "NONE",
  });
}

async function loadPages(ctx: McpContext, ids: string[]): Promise<Map<string, Item>> {
  const pages = await batchGetByKey({
    doc: ctx.doc, tableName: ctx.tables.Pages, keyName: "id", ids,
    projection: "id, workspaceId, title, icon, databaseId, deletedAt",
  });
  return new Map(pages.map((p) => [String(p.id), p]));
}

export const listFavoritesInputShape = {};

export async function listFavoritesTool(ctx: McpContext) {
  const favs = await readFavorites(ctx);
  const pages = await loadPages(ctx, favs.ids);
  const visible = workspaceVisibility(ctx);
  const items: Item[] = [];
  for (const pageId of favs.ids) {
    const page = pages.get(pageId);
    // 영구 삭제된 페이지는 앱이 스스로 정리한다 — 여기서는 보이지 않는 항목으로 둔다.
    if (!page || !(await visible(page.workspaceId))) continue;
    items.push({
      pageId,
      title: page.title ?? "",
      icon: page.icon ?? null,
      workspaceId: page.workspaceId,
      type: page.databaseId ? "databaseRow" : "page",
      ...(page.deletedAt ? { trashed: true } : {}),
    });
  }
  return { favorites: items };
}

export const addFavoriteInputShape = {
  pageId: idInput.describe("Page id to add to the token owner's favorites (appended at the end)"),
};
const addFavoriteInput = z.object(addFavoriteInputShape);

export async function addFavoriteTool(ctx: McpContext, raw: z.input<typeof addFavoriteInput>) {
  const input = addFavoriteInput.parse(raw);
  requireWriteScope(ctx);
  const page = await getItem(ctx.doc, ctx.tables.Pages, { id: input.pageId });
  if (!page) throw new ToolError(NOT_ACCESSIBLE);
  const workspaceId = String(page.workspaceId ?? "");
  await requireWorkspace(ctx, workspaceId);
  if (page.deletedAt) throw new ToolError("This page is in the trash");
  const favs = await readFavorites(ctx);
  if (favs.ids.includes(input.pageId)) return { pageId: input.pageId, alreadyFavorite: true, count: favs.ids.length };
  if (favs.ids.length >= MAX_FAVORITES) throw new ToolError(`Favorites are full (max ${MAX_FAVORITES})`);
  const ws = await getItem(ctx.doc, ctx.tables.Workspaces, { workspaceId });
  const meta = {
    ...favs.meta,
    [input.pageId]: {
      pageId: input.pageId,
      workspaceId,
      workspaceName: typeof ws?.name === "string" ? ws.name : "",
      pageTitle: typeof page.title === "string" && page.title ? page.title : "제목 없음",
      pageIcon: typeof page.icon === "string" ? page.icon : null,
    },
  };
  const ids = [...favs.ids, input.pageId];
  await saveFavorites(ctx, favs, ids, meta);
  return { pageId: input.pageId, added: true, count: ids.length, note: "Shown in the app after its next sync (reload)." };
}

export const removeFavoriteInputShape = {
  pageId: idInput.describe("Page id to remove from favorites (see list_favorites)"),
};
const removeFavoriteInput = z.object(removeFavoriteInputShape);

export async function removeFavoriteTool(ctx: McpContext, raw: z.input<typeof removeFavoriteInput>) {
  const input = removeFavoriteInput.parse(raw);
  requireWriteScope(ctx);
  const favs = await readFavorites(ctx);
  if (!favs.ids.includes(input.pageId)) throw new ToolError("This page is not in favorites");
  const page = await getItem(ctx.doc, ctx.tables.Pages, { id: input.pageId });
  // 남아 있는 페이지는 토큰 범위 안이어야 한다(범위 밖 즐겨찾기를 지우지 않게). 영구 삭제된 페이지는 정리 허용.
  if (page && !(await workspaceVisibility(ctx)(page.workspaceId))) throw new ToolError(NOT_ACCESSIBLE);
  const ids = favs.ids.filter((id) => id !== input.pageId);
  await saveFavorites(ctx, favs, ids, favs.meta);
  return { pageId: input.pageId, removed: true, count: ids.length };
}
