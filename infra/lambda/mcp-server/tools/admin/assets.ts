// 자산·커스텀 아이콘 — v5 asset(listMyAssets·getAssetUsages)·customIcon(listCustomIcons·createCustomIcon) 핸들러 재사용.
// 자산은 토큰 소유자(cognitoSub) 본인 것만. 사용처는 토큰 범위 안 워크스페이스만 보여 준다.
// 커스텀 아이콘 생성은 이미 업로드된 본인 이미지 자산(quicknote-image://<id>)만 받는다 — 임의 URL·base64 는
// 외부 추적 이미지·대용량 페이로드 경로라 받지 않는다(iconInput.ts 와 같은 이유).
import { z } from "zod";
import { getAssetUsages, listMyAssets } from "../../../v5-resolvers/handlers/asset";
import { createCustomIcon, listCustomIcons } from "../../../v5-resolvers/handlers/customIcon";
import { requireWorkspace } from "../../access";
import { ToolError, type McpContext } from "../../context";
import { batchGetByKey, getItem } from "../../ddb";
import { requireWritableWorkspace } from "../../writeAccess";
import { idInput } from "../history/shared";
import { filterVisible, workspaceVisibility } from "./shared";

type Item = Record<string, unknown>;

const IMAGE_SCHEME = "quicknote-image://";
const FILE_SCHEME = "quicknote-file://";
const IMAGE_REF = /^quicknote-image:\/\/([A-Za-z0-9_-]{1,128})$/;

export const ASSET_NOT_USABLE = "Image asset not found, not yours, or not an uploaded image";

function assetRef(a: Item): string {
  return `${String(a.mimeType ?? "").startsWith("image/") ? IMAGE_SCHEME : FILE_SCHEME}${String(a.id)}`;
}

export const listMyAssetsInputShape = {
  sortBy: z.enum(["SIZE_DESC", "SIZE_ASC", "CREATED_AT_DESC"]).optional().describe("Default SIZE_DESC"),
  mimePrefix: z.string().trim().min(1).max(64).optional().describe('Filter by MIME prefix, e.g. "image/"'),
  unusedOnly: z.boolean().optional().describe("Only assets not referenced by any live page or custom icon"),
  minSize: z.number().int().min(0).optional().describe("Minimum size in bytes"),
  limit: z.number().int().min(1).max(200).optional().describe("Max assets (default 50)"),
  cursor: z.string().regex(/^\d{1,7}$/).optional().describe("nextCursor from a previous call"),
};
const listMyAssetsInput = z.object(listMyAssetsInputShape);

export async function listMyAssetsTool(ctx: McpContext, raw: z.input<typeof listMyAssetsInput>) {
  const input = listMyAssetsInput.parse(raw);
  const res = await listMyAssets({
    doc: ctx.doc,
    tables: ctx.tables,
    caller: ctx.caller,
    input: {
      sortBy: input.sortBy,
      filterMimePrefix: input.mimePrefix,
      filterUnusedOnly: input.unusedOnly,
      minSize: input.minSize,
      limit: input.limit ?? 50,
      nextToken: input.cursor,
    },
  });
  const scoped = (ctx.token.workspaceIds ?? []).length > 0;
  const items = scoped ? await inScopeAssets(ctx, res.items) : res.items.map((a) => ({ asset: a, usageCount: a.usageCount }));
  return {
    assets: items.map(({ asset: a, usageCount }) => ({
      id: a.id,
      ref: assetRef(a),
      name: a.name ?? null,
      mimeType: a.mimeType,
      size: a.size,
      createdAt: a.createdAt,
      usageCount,
    })),
    nextCursor: res.nextToken,
  };
}

/**
 * 워크스페이스 범위 한정 토큰: 범위 안 워크스페이스에서 쓰이는 자산만 남기고 사용 수도 범위 안 것만 센다
 * (사용처가 없는 자산은 어느 워크스페이스 것인지 알 수 없어 보이지 않는다). 페이지 크기는 limit 보다 작을 수 있다.
 */
async function inScopeAssets(ctx: McpContext, assets: Item[]): Promise<{ asset: Item; usageCount: number }[]> {
  const visible = workspaceVisibility(ctx);
  const counted = await Promise.all(
    assets.map(async (asset) => {
      const usages = await getAssetUsages({ doc: ctx.doc, tables: ctx.tables, caller: ctx.caller, assetId: String(asset.id) });
      return { asset, usageCount: (await filterVisible(usages, (u) => u.workspaceId, visible)).length };
    }),
  );
  return counted.filter((c) => c.usageCount > 0);
}

export const getAssetUsagesInputShape = {
  assetId: idInput.describe("Asset id from list_my_assets"),
};
const getAssetUsagesInput = z.object(getAssetUsagesInputShape);

export async function getAssetUsagesTool(ctx: McpContext, raw: z.input<typeof getAssetUsagesInput>) {
  const input = getAssetUsagesInput.parse(raw);
  const usages = await getAssetUsages({ doc: ctx.doc, tables: ctx.tables, caller: ctx.caller, assetId: input.assetId });
  const visible = await filterVisible(usages, (u) => u.workspaceId, workspaceVisibility(ctx));
  const pageIds = visible.map((u) => (typeof u.pageId === "string" ? u.pageId : "")).filter(Boolean);
  const pages = await batchGetByKey({ doc: ctx.doc, tableName: ctx.tables.Pages, keyName: "id", ids: pageIds, projection: "id, title" });
  const titles = new Map(pages.map((p) => [String(p.id), String(p.title ?? "")]));
  return {
    assetId: input.assetId,
    usages: visible.map((u) => ({
      workspaceId: u.workspaceId ?? null,
      pageId: u.pageId ?? null,
      ...(typeof u.pageId === "string" ? { pageTitle: titles.get(u.pageId) ?? "" } : {}),
      blockId: u.blockId ?? null,
      blockType: u.blockType ?? null,
    })),
  };
}

export const listCustomIconsInputShape = {
  workspaceId: idInput.describe("Workspace id (see list_workspaces)"),
};
const listCustomIconsInput = z.object(listCustomIconsInputShape);

export async function listCustomIconsTool(ctx: McpContext, raw: z.input<typeof listCustomIconsInput>) {
  const input = listCustomIconsInput.parse(raw);
  await requireWorkspace(ctx, input.workspaceId);
  const icons = await listCustomIcons({ doc: ctx.doc, tables: ctx.tables, caller: ctx.caller, workspaceId: input.workspaceId });
  return {
    workspaceId: input.workspaceId,
    icons: icons.map((i) => ({ id: i.id, label: i.label, src: i.src, createdAt: i.createdAt, createdByMemberId: i.createdByMemberId ?? null })),
  };
}

export const createCustomIconInputShape = {
  workspaceId: idInput.describe("Workspace to add the icon to"),
  src: z.string().trim().regex(IMAGE_REF, 'src must be "quicknote-image://<assetId>" of your uploaded image (see list_my_assets)'),
  label: z.string().trim().max(64).optional().describe("Display label"),
};
const createCustomIconInput = z.object(createCustomIconInputShape);

/** 토큰 소유자의 READY 이미지 자산인지 — 남의 자산을 워크스페이스 아이콘으로 퍼뜨리지 않게. */
async function requireOwnImageAsset(ctx: McpContext, assetId: string): Promise<void> {
  const asset = await getItem(ctx.doc, ctx.tables.ImageAssets, { id: assetId });
  const owned = Boolean(asset) && Boolean(ctx.caller.cognitoSub) && asset?.ownerId === ctx.caller.cognitoSub;
  if (!owned || asset?.status !== "READY" || !String(asset?.mimeType ?? "").startsWith("image/")) {
    throw new ToolError(ASSET_NOT_USABLE);
  }
}

export async function createCustomIconTool(ctx: McpContext, raw: z.input<typeof createCustomIconInput>) {
  const input = createCustomIconInput.parse(raw);
  await requireWritableWorkspace(ctx, input.workspaceId);
  await requireOwnImageAsset(ctx, IMAGE_REF.exec(input.src)?.[1] ?? "");
  const icon = await createCustomIcon({
    doc: ctx.doc,
    tables: ctx.tables,
    caller: ctx.caller,
    input: { workspaceId: input.workspaceId, src: input.src, label: input.label ?? "" },
  });
  return {
    id: icon.id,
    workspaceId: icon.workspaceId,
    src: icon.src,
    label: icon.label,
    note: "Use src as a page icon (update_page icon). Open apps show it in the icon picker after they re-fetch custom icons (reload).",
  };
}
