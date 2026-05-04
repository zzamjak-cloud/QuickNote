import { z } from "zod";
import type { PageMap } from "../../types/page";
import { jsonLikeSchema } from "./jsonTypes";

export const pageSchema = z.object({
  id: z.string(),
  title: z.string(),
  icon: z.string().nullable(),
  doc: jsonLikeSchema,
  parentId: z.string().nullable(),
  order: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  databaseId: z.string().optional(),
  dbCells: z.record(z.string(), z.any()).optional(),
});

export const pageMapSchema = z.record(z.string(), pageSchema);

export function safeParsePageMap(data: unknown): PageMap | null {
  const r = pageMapSchema.safeParse(data);
  return r.success ? (r.data as PageMap) : null;
}
