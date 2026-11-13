// 페이지 표지·제목 색 — 앱 setCoverImage·setTitleColor 와 같은 Pages 메타 필드를 patchPage(upsertPage 경로)로 쓴다.
// upsertPage 가 표지 자산(quicknote-image://) 사용처를 AssetUsage 에 기록하고, 발행으로 열린 클라 메타가 갱신된다.
import { z } from "zod";
import { ToolError, type McpContext } from "../../context";
import { getItem } from "../../ddb";
import { patchPage } from "../../pageWrite";
import { loadWritablePage } from "../../writeAccess";
import { idInput } from "./shared";

export const IMAGE_REF_PREFIX = "quicknote-image://";
const IMAGE_REF = /^quicknote-image:\/\/([A-Za-z0-9_-]{1,200})$/;
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const coverInput = z.string().trim().min(1).max(2048)
  .refine((v) => IMAGE_REF.test(v) || /^https:\/\/[^\s"'<>]+$/.test(v), "cover must be a quicknote-image:// reference (from upload_image) or an https URL");

export const setPageAppearanceInputShape = {
  pageId: idInput,
  cover: coverInput.nullable().optional().describe("Cover image: quicknote-image://… from upload_image, or an https image URL. null removes the cover"),
  titleColor: z.string().trim().regex(HEX_COLOR, "titleColor must be a hex color like #2563eb").nullable().optional()
    .describe("Title text color (hex). App palette: #27272a #ef4444 #f97316 #ca8a04 #16a34a #2563eb #9333ea #db2777. null = default"),
};
const setPageAppearanceInput = z.object(setPageAppearanceInputShape);

async function requireReadyAsset(ctx: McpContext, cover: string): Promise<void> {
  const assetId = IMAGE_REF.exec(cover)?.[1];
  if (!assetId) return;
  const asset = await getItem(ctx.doc, ctx.tables.ImageAssets, { id: assetId });
  if (!asset || asset.status !== "READY") throw new ToolError(`Image ${cover} was not found; upload it with upload_image first`);
}

export async function setPageAppearanceTool(ctx: McpContext, raw: z.input<typeof setPageAppearanceInput>) {
  const input = setPageAppearanceInput.parse(raw);
  if (input.cover === undefined && input.titleColor === undefined) throw new ToolError("Nothing to update: pass cover and/or titleColor");
  const page = await loadWritablePage(ctx, input.pageId);
  if (input.cover) await requireReadyAsset(ctx, input.cover);
  const patch: Record<string, unknown> = {};
  if (input.cover !== undefined) patch.coverImage = input.cover;
  if (input.titleColor !== undefined) patch.titleColor = input.titleColor;
  const saved = await patchPage(ctx, String(page.id), patch);
  return {
    pageId: String(page.id),
    cover: (saved.page.coverImage as string | null | undefined) ?? null,
    titleColor: (saved.page.titleColor as string | null | undefined) ?? null,
    updatedAt: String(saved.page.updatedAt ?? ""),
  };
}
