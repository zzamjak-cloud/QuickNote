import { z } from "zod";

/** JSON 호환 트리 — storage·TipTap doc 검증용 */
export const jsonLikeSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonLikeSchema),
    z.record(z.string(), jsonLikeSchema),
  ]),
);
