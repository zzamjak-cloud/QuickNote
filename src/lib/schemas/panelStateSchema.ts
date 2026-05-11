import { z } from "zod";
import type { DatabasePanelState } from "../../types/database";
import { emptyPanelState } from "../../types/database";

const filterOperatorSchema = z.enum([
  "equals",
  "notEquals",
  "contains",
  "isEmpty",
  "isNotEmpty",
  "gt",
  "lt",
]);

const filterRuleSchema = z.object({
  id: z.string(),
  columnId: z.string(),
  operator: filterOperatorSchema,
  value: z.string().optional(),
});

const sortRuleSchema = z.object({
  columnId: z.string(),
  dir: z.enum(["asc", "desc"]),
});

const viewSpecificSchema = z.object({
  visibleColumnIds: z.array(z.string()).optional(),
  hiddenColumnIds: z.array(z.string()).optional(),
});

const viewKindEnum = z.enum(["table", "kanban", "timeline", "gallery"]);

/** attrs 에 부분 저장 가능 — 알려진 키만 통과·알 수 없는 키는 제거(CWE-1321 완화) */
const databasePanelStatePartialSchema = z
  .object({
    searchQuery: z.string().optional(),
    filterRules: z.array(filterRuleSchema).optional(),
    sortColumnId: z.string().nullable().optional(),
    sortDir: z.enum(["asc", "desc"]).optional(),
    sortRules: z.array(sortRuleSchema).optional(),
    kanbanGroupColumnId: z.string().nullable().optional(),
    galleryCoverColumnId: z.string().nullable().optional(),
    timelineDateColumnId: z.string().nullable().optional(),
    viewConfigs: z.record(viewKindEnum, viewSpecificSchema).optional(),
    hiddenViewKinds: z.array(viewKindEnum).optional(),
  });

export function parseDatabasePanelStateJson(raw: string): DatabasePanelState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyPanelState();
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return emptyPanelState();
  }
  const base = emptyPanelState();
  const r = databasePanelStatePartialSchema.safeParse(parsed);
  if (!r.success) return base;
  return { ...base, ...r.data };
}
